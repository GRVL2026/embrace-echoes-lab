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
    return await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });
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

/* ---------------- Period handling ---------------- */

type PeriodKey = "7d" | "30d" | "90d" | "12m" | "all";

function periodToDays(p: PeriodKey): number {
  switch (p) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    case "12m": return 365;
    case "all": return 3650; // ~10 years max window
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

const ORDER_FIELDS = `
  id name createdAt displayFinancialStatus displayFulfillmentStatus
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  customer {
    id displayName firstName lastName email phone
    numberOfOrders
    defaultAddress { city country }
  }
  shippingAddress { city country }
  lineItems(first: 50) {
    edges { node {
      quantity title variantTitle
      product { id title }
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      originalTotalSet { shopMoney { amount currencyCode } }
    } }
  }
`;

async function fetchOrdersRange(sinceIso: string, untilIso?: string) {
  const results: any[] = [];
  let cursor: string | null = null;
  const dateFilter = untilIso
    ? `created_at:>='${sinceIso}' AND created_at:<'${untilIso}'`
    : `created_at:>='${sinceIso}'`;
  for (let i = 0; i < 80; i++) { // up to 20k orders
    const data: any = await gql(
      `query($cursor: String, $q: String!) {
        orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${ORDER_FIELDS} } }
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

function mapOrderDetail(o: any, fallbackCurrency: string) {
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    customer: o.customer?.displayName || "—",
    customerEmail: o.customer?.email || null,
    customerPhone: o.customer?.phone || null,
    customerCity: o.shippingAddress?.city || o.customer?.defaultAddress?.city || null,
    customerCountry: o.shippingAddress?.country || o.customer?.defaultAddress?.country || null,
    customerOrders: Number(o.customer?.numberOfOrders || 0),
    amount: Number(o.totalPriceSet?.shopMoney?.amount || 0),
    subtotal: Number(o.subtotalPriceSet?.shopMoney?.amount || 0),
    shipping: Number(o.totalShippingPriceSet?.shopMoney?.amount || 0),
    tax: Number(o.totalTaxSet?.shopMoney?.amount || 0),
    currency: o.totalPriceSet?.shopMoney?.currencyCode || fallbackCurrency,
    financial: o.displayFinancialStatus,
    fulfillment: o.displayFulfillmentStatus,
    lineItems: (o.lineItems?.edges || []).map((e: any) => ({
      title: e.node.title,
      variant: e.node.variantTitle,
      quantity: Number(e.node.quantity || 0),
      unitPrice: Number(e.node.originalUnitPriceSet?.shopMoney?.amount || 0),
      total: Number(e.node.originalTotalSet?.shopMoney?.amount || 0),
    })),
  };
}

async function buildStats(period: PeriodKey) {
  const now = new Date();
  const days = periodToDays(period);
  const sinceIso = isoDaysAgo(days);
  const prevSinceIso = isoDaysAgo(days * 2);

  const [ordersCur, ordersPrev, lowStock, trafficRaw] = await Promise.all([
    fetchOrdersRange(sinceIso),
    fetchOrdersRange(prevSinceIso, sinceIso),
    fetchLowStock(),
    tryShopifyQL(),
  ]);

  const sum = (arr: any[]) =>
    arr.reduce((s, o) => s + Number(o.totalPriceSet?.shopMoney?.amount || 0), 0);
  const caCur = sum(ordersCur);
  const caPrev = sum(ordersPrev);
  const countCur = ordersCur.length;
  const countPrev = ordersPrev.length;
  const currency = ordersCur[0]?.totalPriceSet?.shopMoney?.currencyCode
    || ordersPrev[0]?.totalPriceSet?.shopMoney?.currencyCode
    || "EUR";
  const aov = countCur ? caCur / countCur : 0;
  const aovPrev = countPrev ? caPrev / countPrev : 0;
  const evolCA = caPrev ? ((caCur - caPrev) / caPrev) * 100 : 0;
  const evolCount = countPrev ? ((countCur - countPrev) / countPrev) * 100 : 0;
  const evolAov = aovPrev ? ((aov - aovPrev) / aovPrev) * 100 : 0;

  // Sales by day — last 7 days (always)
  const perDay = new Map<string, { day: string; amount: number; count: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10);
    perDay.set(d, { day: d, amount: 0, count: 0 });
  }
  for (const o of ordersCur) {
    const d = o.createdAt.slice(0, 10);
    if (perDay.has(d)) {
      const v = perDay.get(d)!;
      v.amount += Number(o.totalPriceSet?.shopMoney?.amount || 0);
      v.count += 1;
    }
  }
  const salesByDay = Array.from(perDay.values());

  // Sales by month — over the current period (bounded to 24 max)
  const perMonth = new Map<string, { month: string; amount: number; count: number }>();
  const monthsWindow = Math.min(24, Math.max(1, Math.ceil(days / 30)));
  for (let i = monthsWindow - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    perMonth.set(key, { month: key, amount: 0, count: 0 });
  }
  for (const o of ordersCur) {
    const key = o.createdAt.slice(0, 7);
    if (!perMonth.has(key)) perMonth.set(key, { month: key, amount: 0, count: 0 });
    const v = perMonth.get(key)!;
    v.amount += Number(o.totalPriceSet?.shopMoney?.amount || 0);
    v.count += 1;
  }
  const salesByMonth = Array.from(perMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Top products
  const prodMap = new Map<string, { title: string; qty: number; revenue: number }>();
  for (const o of ordersCur) {
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

  // New vs returning
  let newCust = 0;
  let returningCust = 0;
  for (const o of ordersCur) {
    const n = Number(o.customer?.numberOfOrders || 0);
    if (n <= 1) newCust += 1;
    else returningCust += 1;
  }
  const returningShare = countCur ? (returningCust / countCur) * 100 : 0;

  // Latest orders — enriched detail
  const latest = ordersCur.slice(0, 15).map((o) => mapOrderDetail(o, currency));

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
      ? (ordersCur.filter((o) => new Date(o.createdAt).getTime() >= Date.now() - 7 * 86400_000).length / trafficRaw.sessions) * 100
      : 0;
    traffic = { sessions: trafficRaw.sessions, conversion };
  }

  return {
    currency,
    period: { key: period, days, since: sinceIso },
    kpi: {
      ca30: caCur, caPrev, evolCA,
      count30: countCur, countPrev, evolCount,
      aov, aovPrev, evolAov,
      returningShare,
    },
    salesByDay,
    salesByMonth,
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
    const rawPeriod = (url.searchParams.get("period") || "30d") as PeriodKey;
    const period: PeriodKey = ["7d", "30d", "90d", "12m", "all"].includes(rawPeriod) ? rawPeriod : "30d";

    if (!force) {
      const { data: cached } = await supabase
        .from("shopify_stats_cache")
        .select("data,fetched_at")
        .eq("period", period)
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

    const stats = await buildStats(period);
    const fetched_at = new Date().toISOString();
    await supabase.from("shopify_stats_cache").delete().eq("period", period);
    await supabase.from("shopify_stats_cache").insert({ data: stats, fetched_at, period });

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
