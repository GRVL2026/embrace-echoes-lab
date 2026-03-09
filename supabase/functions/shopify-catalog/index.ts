import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SHOPIFY_STORE = "zhx0nb-11.myshopify.com";
const API_VERSION = "2025-01";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!SHOPIFY_ACCESS_TOKEN) {
    return new Response(
      JSON.stringify({ error: "SHOPIFY_ACCESS_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const url = new URL(req.url);
    const searchQuery = url.searchParams.get("query") || "";
    
    // Fetch ALL products with metafields using Admin API (paginated)
    const allProducts: any[] = [];
    let pageInfo: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const graphqlQuery = `
        query ($first: Int!, $after: String${searchQuery ? ", $query: String" : ""}) {
          products(first: $first, after: $after${searchQuery ? ", query: $query" : ""}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                descriptionHtml
                handle
                productType
                vendor
                tags
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                images(first: 5) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                metafields(first: 20) {
                  edges {
                    node {
                      namespace
                      key
                      value
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const variables: Record<string, unknown> = { first: 50 };
      if (pageInfo) variables.after = pageInfo;
      if (searchQuery) variables.query = searchQuery;

      const response = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          },
          body: JSON.stringify({ query: graphqlQuery, variables }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Shopify Admin API error [${response.status}]: ${errText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        throw new Error(`GraphQL errors: ${data.errors.map((e: any) => e.message).join(", ")}`);
      }

      const products = data.data.products;
      for (const edge of products.edges) {
        const node = edge.node;
        const metafields: Record<string, string> = {};
        for (const mfEdge of (node.metafields?.edges || [])) {
          const mf = mfEdge.node;
          metafields[`${mf.namespace}.${mf.key}`] = mf.value;
        }

        allProducts.push({
          id: node.id,
          title: node.title,
          description: node.descriptionHtml || "",
          handle: node.handle,
          productType: node.productType || "",
          vendor: node.vendor || "",
          tags: node.tags || [],
          price: node.priceRangeV2?.minVariantPrice?.amount || "0",
          currency: node.priceRangeV2?.minVariantPrice?.currencyCode || "EUR",
          images: (node.images?.edges || []).map((ie: any) => ie.node.url),
          metafields,
        });
      }

      hasNextPage = products.pageInfo.hasNextPage;
      pageInfo = products.pageInfo.endCursor;
    }

    return new Response(JSON.stringify({ products: allProducts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching Shopify catalog:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
