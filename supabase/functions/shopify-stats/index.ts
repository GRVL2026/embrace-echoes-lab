// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SHOP = Deno.env.get("SHOPIFY_SHOP_DOMAIN") || "";
const CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET") || "";
const API_VERSION = "2026-01";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/* ---------------- Token cache (client_credentials) ---------------- */

async function fetchNewToken(): Promise<{ access_token: string; expires_at: string }> {
  const url = `https://${SHOP}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed ${res.status}: ${t}`);
  }
  const j = await res.json();
  const expiresInSec = Number(j.expires_in ?? 60 * 60 * 24);
  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
  return { access_token: j.access_token, expires_at: expiresAt };
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const { data } = await supabase
      .from("shopify_token_cache")
      .select("access_token,expires_at,shop_domain")
      .eq("shop_domain", SHOP)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
      return data.access_token;
    }
  }
  const fresh = await fetchNewToken();
  await supabase.from("shopify_token_cache").delete().eq("shop_domain", SHOP);
  await supabase.from("shopify_token_cache").insert({
    access_token: fresh.access_token,
    expires_at: fresh.expires_at,
    shop_domain: SHOP,
  });
  return fresh.access_token;
}

/* ---------------- GraphQL helper with 401 retry ---------------- */

async function gql(query: string, variables: Record<string, any> = {}): Promise<any> {
  const doCall = async (token: string) => {
    const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });
    return r;
  };

  let token = await getAccessToken();
  let res = await doCall(token);
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await doCall(token);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GraphQL ${res.status}: ${t}`);
  }
  const j = await res.json();
  if (j.errors) throw new Error(`GraphQL errors: ${JSON.stringify(j.errors)}`);
  return j.data;
}

/* ---------------- Stats aggregation ---------------- */

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

async function fetchOrdersRange(sinceIso: string, untilIso?: string) {
  const results: any[] = [];
  let cursor: string | null = null;
  const dateFilter = untilIso
    ? `created_at:>='${sinceIso}' AND created_at:<'${untilIso}'`
    : `created_at:>='${sinceIso}'`;
  for (let i = 0; i < 20; i++) {
    const data: any = await gql(
      `query($cursor: String, $q: String!) {
        orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges { node {
            id name createdAt displayFinancialStatus displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { id displayName numberOfOrders }
            lineItems(first: 25) { edges { node { quantity title
              product { id title }
              originalTotalSet { shopMoney { amount } }
            } } }
          } }
        }
      }`,
      { cursor, q: dateFilter },
    );
    const edges = data.orders.edges;
    results.push(...edges.map((e: any) => e.node));
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return results;
}

async function fetchLowStock() {
  const data: any = await gql(
    `query {
      productVariants(first: 50, query: "inventory_quantity:<5") {
        edges { node {
          id title sku inventoryQuantity
          product { id title handle featuredImage { url } }
        } }
      }
    }`,
  );
  return data.productVariants.edges.map((e: any) => e.node);
}

async function tryShopifyQL(): Promise<{ sessions: number; conversion: number } | null> {
  try {
    const sinceDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const untilDate = new Date().toISOString().slice(0, 10);
    const q = `
      FROM sessions
      SHOW sum(sessions) AS sessions
      WHERE start_time >= '${sinceDate}' AND start_time <= '${untilDate}'
    `;
    const data: any = await gql(
      `query($q: String!) {
        shopifyqlQuery(query: $q) {
          ... on TableResponse { tableData { rowData } }
        }
      }`,
      { q },
    );
    const row = data?.shopifyqlQuery?.tableData?.rowData?.[0];
    const sessions = row ? Number(row[0]) : 0;
    return { sessions, conversion: 0 };
  } catch {
    return null;
  }
}

async function buildStats() {
  const now = new Date();
  const since30 = isoDaysAgo(30);
  const since60 = isoDaysAgo(60);
  const since7 = isoDaysAgo(7);

  const [orders30, orders60to30, lowStock, trafficRaw] = await Promise.all([
    fetchOrdersRange(since30),
    fetchOrdersRange(since60, since30),
    fetchLowStock(),
    tryShopifyQL(),
  ]);

  const sum = (arr: any[]) =>
    arr.reduce((s, o) => s + Number(o.totalPriceSet?.shopMoney?.amount || 0), 0);
  const ca30 = sum(orders30);
  const caPrev = sum(orders60to30);
  const count30 = orders30.length;
  const countPrev = orders60to30.length;
  const currency = orders30[0]?.totalPriceSet?.shopMoney?.currencyCode || "EUR";
  const aov = count30 ? ca30 / count30 : 0;
  const aovPrev = countPrev ? caPrev / countPrev : 0;
  const evolCA = caPrev ? ((ca30 - caPrev) / caPrev) * 100 : 0;
  const evolCount = countPrev ? ((count30 - countPrev) / countPrev) * 100 : 0;
  const evolAov = aovPrev ? ((aov - aovPrev) / aovPrev) * 100 : 0;

  // Sales per day (last 7 days)
  const perDay = new Map<string, { day: string; amount: number; count: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10);
    perDay.set(d, { day: d, amount: 0, count: 0 });
  }
  for (const o of orders30) {
    const d = o.createdAt.slice(0, 10);
    if (perDay.has(d)) {
      const v = perDay.get(d)!;
      v.amount += Number(o.totalPriceSet?.shopMoney?.amount || 0);
      v.count += 1;
    }
  }
  const salesByDay = Array.from(perDay.values());

  // Top products
  const prodMap = new Map<string, { title: string; qty: number; revenue: number }>();
  for (const o of orders30) {
    for (const li of o.lineItems?.edges || []) {
      const n = li.node;
      const key = n.product?.id || n.title;
      const cur = prodMap.get(key) || { title: n.product?.title || n.title, qty: 0, revenue: 0 };
      cur.qty += Number(n.quantity || 0);
      cur.revenue += Number(n.originalTotalSet?.shopMoney?.amount || 0);
      prodMap.set(key, cur);
    }
  }
  const topProducts = Array.from(prodMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // New vs returning customers (approx via numberOfOrders on customer at time of query)
  let newCust = 0;
  let returningCust = 0;
  for (const o of orders30) {
    const n = Number(o.customer?.numberOfOrders || 0);
    if (n <= 1) newCust += 1;
    else returningCust += 1;
  }

  // Latest 10 orders
  const latest = orders30.slice(0, 10).map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    customer: o.customer?.displayName || "—",
    amount: Number(o.totalPriceSet?.shopMoney?.amount || 0),
    currency: o.totalPriceSet?.shopMoney?.currencyCode || currency,
    financial: o.displayFinancialStatus,
    fulfillment: o.displayFulfillmentStatus,
  }));

  const lowStockOut = lowStock.map((v: any) => ({
    id: v.id,
    productTitle: v.product?.title,
    handle: v.product?.handle,
    image: v.product?.featuredImage?.url || null,
    variantTitle: v.title,
    sku: v.sku,
    quantity: v.inventoryQuantity,
  }));

  let traffic: any = null;
  if (trafficRaw) {
    const conversion = trafficRaw.sessions > 0
      ? (orders30.filter((o) => new Date(o.createdAt).getTime() >= Date.now() - 7 * 86400_000).length / trafficRaw.sessions) * 100
      : 0;
    traffic = { sessions: trafficRaw.sessions, conversion };
  }

  return {
    currency,
    period: { days: 30, since: since30 },
    kpi: {
      ca30, caPrev, evolCA,
      count30, countPrev, evolCount,
      aov, aovPrev, evolAov,
    },
    salesByDay,
    topProducts,
    customers: { new: newCust, returning: returningCust },
    latestOrders: latest,
    lowStock: lowStockOut,
    traffic,
  };
}

/* ---------------- Handler ---------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
      return new Response(
        JSON.stringify({ error: "Missing SHOPIFY_SHOP_DOMAIN / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("refresh") === "1";

    if (!force) {
      const { data: cached } = await supabase
        .from("shopify_stats_cache")
        .select("data,fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
        return new Response(
          JSON.stringify({ ...cached.data, fetched_at: cached.fetched_at, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const stats = await buildStats();
    const fetched_at = new Date().toISOString();
    // Replace cache
    await supabase.from("shopify_stats_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("shopify_stats_cache").insert({ data: stats, fetched_at });

    return new Response(
      JSON.stringify({ ...stats, fetched_at, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("shopify-stats error", e);
    return new Response(
      JSON.stringify({ error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
