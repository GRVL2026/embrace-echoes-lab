import { toast } from "sonner";
import type { GameEquipment } from "@/types/equipment";
import { DEFAULT_SAFETY_ZONE } from "@/types/equipment";

const SHOPIFY_API_VERSION = '2025-07';
const SHOPIFY_STORE_PERMANENT_DOMAIN = 'zhx0nb-11.myshopify.com';
const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
const SHOPIFY_STOREFRONT_TOKEN = 'f36741b7243852cec60caa6969e7a434';

// Color palette for equipment categories
const CATEGORY_COLORS: Record<string, string> = {
  "arcade": "hsl(263, 85%, 68%)",
  "flipper": "hsl(75, 100%, 45%)",
  "flippers": "hsl(75, 100%, 45%)",
  "billard": "hsl(200, 80%, 50%)",
  "babyfoot": "hsl(30, 90%, 55%)",
  "flechettes": "hsl(0, 70%, 55%)",
  "simulateur": "hsl(180, 70%, 50%)",
  "sport": "hsl(142, 76%, 45%)",
  "tir": "hsl(0, 85%, 55%)",
  "jeux famille": "hsl(280, 70%, 60%)",
  "grues & distributeurs": "hsl(45, 90%, 50%)",
  "réalité virtuelle": "hsl(200, 90%, 55%)",
  "adresse": "hsl(330, 70%, 55%)",
  "jeux de conduite": "hsl(15, 85%, 55%)",
  "default": "hsl(48, 100%, 50%)",
};

function getCategoryColor(category: string): string {
  const key = category.toLowerCase();
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.default;
}

async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 402) {
    toast.error("Shopify: abonnement requis", {
      description: "L'accès API Shopify nécessite un plan payant actif.",
    });
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Shopify: ${data.errors.map((e: { message: string }) => e.message).join(', ')}`);
  }
  return data;
}

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          description
          handle
          productType
          vendor
          tags
          priceRange {
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
          variants(first: 10) {
            edges {
              node {
                id
                title
                price {
                  amount
                  currencyCode
                }
                availableForSale
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          metafields(identifiers: [
            { namespace: "custom", key: "dimensions" },
            { namespace: "custom", key: "power" },
            { namespace: "custom", key: "screen" },
            { namespace: "custom", key: "capacity" },
            { namespace: "custom", key: "tickets" },
            { namespace: "custom", key: "weight" },
            { namespace: "custom", key: "warranty" }
          ]) {
            key
            value
          }
        }
      }
    }
  }
`;

/** Parse dimensions like "L 1030 x P 2500 x H 2640 mm" or "35X22X12" */
function parseDimensions(dimStr: string): { width: number; depth: number; height: number } | null {
  if (!dimStr?.trim()) return null;
  const s = dimStr.trim();

  const lph = s.match(/L\s*[:\s]*(\d+)\s*[x×\s]+P\s*[:\s]*(\d+)\s*[x×\s]+H\s*[:\s]*(\d+)/i);
  if (lph) {
    return { width: parseInt(lph[1], 10) / 10, depth: parseInt(lph[2], 10) / 10, height: parseInt(lph[3], 10) / 10 };
  }

  const plain = s.match(/(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)/);
  if (plain) {
    return { width: parseInt(plain[1], 10), depth: parseInt(plain[2], 10), height: parseInt(plain[3], 10) };
  }

  return null;
}

interface ShopifyProductNode {
  id: string;
  title: string;
  description: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  images: { edges: Array<{ node: { url: string; altText: string | null } }> };
  variants: { edges: Array<{ node: { id: string; title: string; price: { amount: string; currencyCode: string }; availableForSale: boolean; selectedOptions: Array<{ name: string; value: string }> } }> };
  metafields: Array<{ key: string; value: string } | null>;
}

function shopifyProductToEquipment(product: ShopifyProductNode): GameEquipment {
  const dimMeta = product.metafields?.find(m => m?.key === "dimensions");
  const dims = dimMeta ? parseDimensions(dimMeta.value) : null;

  // Also try to extract dimensions from description
  const descDims = !dims ? parseDimensions(product.description || "") : null;
  const finalDims = dims || descDims;

  const price = parseFloat(product.priceRange.minVariantPrice.amount);
  const category = product.productType || "autre";

  const powerMeta = product.metafields?.find(m => m?.key === "power");
  const screenMeta = product.metafields?.find(m => m?.key === "screen");
  const capacityMeta = product.metafields?.find(m => m?.key === "capacity");
  const ticketsMeta = product.metafields?.find(m => m?.key === "tickets");
  const warrantyMeta = product.metafields?.find(m => m?.key === "warranty");

  return {
    id: product.handle, // use handle as stable ID
    name: product.title,
    category,
    width: finalDims?.width || 100,
    depth: finalDims?.depth || 100,
    height: finalDims?.height || 200,
    safetyZone: DEFAULT_SAFETY_ZONE,
    color: getCategoryColor(category),
    description: product.description || undefined,
    vendor: product.vendor || undefined,
    price: price > 0 ? price : undefined,
    images: product.images.edges.map(e => e.node.url),
    tags: product.tags.length > 0 ? product.tags : undefined,
    warranty: warrantyMeta?.value || undefined,
    specs: {
      power: powerMeta?.value || undefined,
      screen: screenMeta?.value || undefined,
      capacity: capacityMeta?.value || undefined,
      tickets: ticketsMeta?.value?.toLowerCase() === "oui" ? true :
               ticketsMeta?.value?.toLowerCase() === "non" ? false : undefined,
    },
  };
}

/**
 * Fetch all products from Shopify Storefront API, paginating automatically.
 * Returns GameEquipment[] ready for the catalog.
 */
export async function fetchShopifyCatalog(searchQuery?: string): Promise<GameEquipment[]> {
  const allProducts: GameEquipment[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  const pageSize = 50;

  while (hasNextPage) {
    const variables: Record<string, unknown> = { first: pageSize };
    if (cursor) variables.after = cursor;
    if (searchQuery?.trim()) variables.query = searchQuery.trim();

    const data = await storefrontApiRequest(PRODUCTS_QUERY, variables);
    if (!data) return allProducts; // billing error

    const products = data.data.products;
    for (const edge of products.edges) {
      allProducts.push(shopifyProductToEquipment(edge.node));
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allProducts;
}
