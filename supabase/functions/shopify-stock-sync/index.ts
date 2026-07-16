// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SHOP = Deno.env.get("SHOPIFY_SHOP_DOMAIN") || "";
const CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET") || "";
const API_VERSION = "2026-01";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/* ---------------- Token cache (client_credentials) ---------------- */

async function fetchNewToken(): Promise<{ access_token: string; expires_at: string }> {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const expiresInSec = Number(j.expires_in ?? 60 * 60 * 24);
  return {
    access_token: j.access_token,
    expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const { data } = await admin
      .from("shopify_token_cache")
      .select("access_token,expires_at")
      .eq("shop_domain", SHOP)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
      return data.access_token;
    }
  }
  const fresh = await fetchNewToken();
  await admin.from("shopify_token_cache").delete().eq("shop_domain", SHOP);
  await admin.from("shopify_token_cache").insert({ ...fresh, shop_domain: SHOP });
  return fresh.access_token;
}

async function gql(query: string, variables: Record<string, any> = {}): Promise<any> {
  const doCall = async (token: string) =>
    fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

  let token = await getAccessToken();
  let res = await doCall(token);
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await doCall(token);
  }
  if (res.status === 403) {
    throw new Error("SHOPIFY_FORBIDDEN");
  }
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (j.errors) {
    const msg = JSON.stringify(j.errors);
    if (/access denied|not approved|scope/i.test(msg)) throw new Error("SHOPIFY_FORBIDDEN");
    throw new Error(`GraphQL errors: ${msg}`);
  }
  return j.data;
}

/* ---------------- Helpers ---------------- */

function toProductGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  const numeric = id.replace(/\D/g, "");
  return `gid://shopify/Product/${numeric}`;
}

async function getPrimaryLocationId(): Promise<string> {
  const data = await gql(`query { locations(first: 5) { edges { node { id name isPrimary } } } }`);
  const edges = data.locations.edges || [];
  const primary = edges.find((e: any) => e.node.isPrimary) || edges[0];
  if (!primary) throw new Error("Aucune location Shopify trouvée");
  return primary.node.id;
}

/**
 * For a Shopify product ID (numeric or gid), returns first variant with
 * its inventoryItem id and the total inventory quantity at the primary location.
 */
async function fetchProductVariantInventory(
  productId: string,
  locationId: string,
): Promise<{ variantId: string; inventoryItemId: string; qty: number; title: string } | null> {
  const data = await gql(
    `query($id: ID!) {
      product(id: $id) {
        title
        variants(first: 5) {
          edges { node {
            id title
            inventoryItem {
              id
              inventoryLevel(locationId: "${locationId}") {
                quantities(names: ["available"]) { name quantity }
              }
            }
          } }
        }
      }
    }`,
    { id: toProductGid(productId) },
  );
  const p = data.product;
  if (!p) return null;
  const v = p.variants?.edges?.[0]?.node;
  if (!v?.inventoryItem?.id) return null;
  const q = v.inventoryItem.inventoryLevel?.quantities?.find((x: any) => x.name === "available");
  return {
    variantId: v.id,
    inventoryItemId: v.inventoryItem.id,
    qty: Number(q?.quantity ?? 0),
    title: p.title,
  };
}

async function applyInventory(
  inventoryItemId: string,
  locationId: string,
  qty: number,
  compareQty: number,
): Promise<void> {
  const data = await gql(
    `mutation($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message code }
      }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: false,
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity: Math.max(0, Math.floor(qty)),
            compareQuantity: Math.max(0, Math.floor(compareQty)),
          },
        ],
      },
    },
  );
  const errs = data.inventorySetQuantities?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e: any) => e.message).join("; "));
}

/* ---------------- Handler ---------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
      return new Response(
        JSON.stringify({ error: "Secrets Shopify manquants" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Auth: verify caller is authenticated + admin
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const userId = claims?.claims?.sub;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    const isDirection = (roles ?? []).some((r) => r.role === "direction");

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = (body?.mode as string) || "preview";

    if (mode === "preview") {
      if (!isAdmin && !isDirection) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mapped products
      const { data: products, error: pErr } = await admin
        .from("catalog_products")
        .select("id,name,cegid_code,shopify_id")
        .not("cegid_code", "is", null)
        .not("shopify_id", "is", null);
      if (pErr) throw new Error(pErr.message);

      // ERP stock
      const codes = Array.from(new Set((products ?? []).map((p) => (p.cegid_code || "").trim()).filter(Boolean)));
      const erpMap = new Map<string, number>();
      if (codes.length) {
        const { data: erp } = await admin
          .from("v_gaia_articles")
          .select("code,stock")
          .in("code", codes);
        for (const r of erp ?? []) erpMap.set(String(r.code).trim(), Number(r.stock ?? 0));
      }

      // Last Cegid sync timestamp
      const { data: lastSync } = await admin
        .from("gaia_stock")
        .select("updated_at")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      // Primary location + per-product Shopify stock
      const locationId = await getPrimaryLocationId();
      const rows: any[] = [];
      for (const p of products ?? []) {
        const erpQty = erpMap.get((p.cegid_code || "").trim()) ?? null;
        try {
          const inv = await fetchProductVariantInventory(p.shopify_id!, locationId);
          if (!inv) {
            rows.push({
              productId: p.id, name: p.name, cegid: p.cegid_code, shopifyId: p.shopify_id,
              erp: erpQty, shopify: null, delta: null,
              status: "missing", message: "Produit Shopify introuvable",
            });
            continue;
          }
          const delta = erpQty === null ? null : Math.floor(erpQty) - inv.qty;
          rows.push({
            productId: p.id,
            name: p.name || inv.title,
            cegid: p.cegid_code,
            shopifyId: p.shopify_id,
            variantId: inv.variantId,
            inventoryItemId: inv.inventoryItemId,
            erp: erpQty,
            shopify: inv.qty,
            delta,
            status: "ok",
          });
        } catch (e: any) {
          if (String(e?.message) === "SHOPIFY_FORBIDDEN") throw e;
          rows.push({
            productId: p.id, name: p.name, cegid: p.cegid_code, shopifyId: p.shopify_id,
            erp: erpQty, shopify: null, delta: null,
            status: "error", message: e?.message || String(e),
          });
        }
      }

      return new Response(
        JSON.stringify({
          mode: "preview",
          locationId,
          lastCegidSync: lastSync?.updated_at ?? null,
          count: rows.length,
          rows,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "apply") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin uniquement" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Internal validation gate — controlled by gaia_config.stock_sync_apply_enabled
      const { data: cfg } = await admin
        .from("gaia_config")
        .select("value")
        .eq("key", "stock_sync_apply_enabled")
        .maybeSingle();
      const enabled = String(cfg?.value ?? "false").toLowerCase() === "true";
      if (!enabled) {
        return new Response(
          JSON.stringify({ error: "Synchronisation des stocks désactivée — en attente de validation interne" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }


      const items = Array.isArray(body?.items) ? body.items : [];
      if (!items.length) {
        return new Response(JSON.stringify({ error: "Aucun produit fourni" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const locationId = await getPrimaryLocationId();
      const results: any[] = [];

      for (const it of items) {
        const productId = String(it.productId || "");
        const targetQty = Number(it.targetQty);
        if (!productId || !Number.isFinite(targetQty)) {
          results.push({ productId, status: "error", message: "Paramètres invalides" });
          continue;
        }

        const { data: prod } = await admin
          .from("catalog_products")
          .select("id,name,cegid_code,shopify_id")
          .eq("id", productId)
          .maybeSingle();
        if (!prod || !prod.shopify_id) {
          results.push({ productId, status: "error", message: "Produit non trouvé ou non lié Shopify" });
          continue;
        }

        try {
          const inv = await fetchProductVariantInventory(prod.shopify_id, locationId);
          if (!inv) throw new Error("Variant Shopify introuvable");
          const before = inv.qty;
          await applyInventory(inv.inventoryItemId, locationId, targetQty, before);
          const after = Math.floor(targetQty);
          await admin.from("stock_sync_log").insert({
            product_name: prod.name,
            cegid_code: prod.cegid_code,
            shopify_variant_id: inv.variantId,
            qty_before: before,
            qty_after: after,
            delta: after - before,
            status: "ok",
            triggered_by: userId,
          });
          results.push({ productId, name: prod.name, before, after, status: "ok" });
        } catch (e: any) {
          const forbidden = String(e?.message) === "SHOPIFY_FORBIDDEN";
          const message = forbidden
            ? "Ajoutez la portée write_inventory à l'app Shopify"
            : e?.message || String(e);
          await admin.from("stock_sync_log").insert({
            product_name: prod.name,
            cegid_code: prod.cegid_code,
            shopify_variant_id: null,
            qty_before: null,
            qty_after: null,
            delta: null,
            status: forbidden ? "forbidden" : "error",
            message,
            triggered_by: userId,
          });
          results.push({ productId, name: prod.name, status: forbidden ? "forbidden" : "error", message });
          if (forbidden) break; // pointless to continue if scope missing
        }
      }

      return new Response(
        JSON.stringify({ mode: "apply", count: results.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "mode inconnu" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const forbidden = String(e?.message) === "SHOPIFY_FORBIDDEN";
    return new Response(
      JSON.stringify({
        error: forbidden
          ? "Ajoutez la portée write_inventory (ou read_inventory) à l'app Shopify"
          : (e?.message || String(e)),
      }),
      { status: forbidden ? 403 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
