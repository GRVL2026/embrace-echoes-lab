import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOKEN_URL = 'https://xrp-flex.cegid.cloud/avranches-automatic/identity/connect/token';
const TIMEOUT_MS = 25000;
const PAGE_SIZE = 2000;
const INSERT_BATCH = 500;

const FEEDS: { name: string; url: string }[] = [
  { name: 'BD-Clients',    url: 'https://xrp-flex.cegid.cloud/avranches-automatic/ODATA/AVRANCHES/BD-Clients' },
  { name: 'BD-Ventes',     url: 'https://xrp-flex.cegid.cloud/avranches-automatic/ODATA/AVRANCHES/BD-Ventes' },
  { name: 'BD-Historique', url: 'https://xrp-flex.cegid.cloud/avranches-automatic/ODATA/AVRANCHES/BD-Historique' },
  { name: 'BD-Commandes',  url: 'https://xrp-flex.cegid.cloud/avranches-automatic/ODATA/AVRANCHES/BD-Commandes' },
  { name: 'BD-Stock',      url: 'https://xrp-flex.cegid.cloud/avranches-automatic/ODATA/AVRANCHES/BD-Stock' },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type TokenStep = {
  ok: boolean;
  http_status?: number;
  duration_ms: number;
  error?: string;
  preview?: string;
  token?: string;
};

async function fetchToken(): Promise<TokenStep> {
  const started = Date.now();
  const clientId = Deno.env.get('CEGID_CLIENT_ID');
  const clientSecret = Deno.env.get('CEGID_CLIENT_SECRET');
  const username = Deno.env.get('CEGID_USERNAME');
  const password = Deno.env.get('CEGID_PASSWORD');

  const missing: string[] = [];
  if (!clientId) missing.push('CEGID_CLIENT_ID');
  if (!clientSecret) missing.push('CEGID_CLIENT_SECRET');
  if (!username) missing.push('CEGID_USERNAME');
  if (!password) missing.push('CEGID_PASSWORD');
  if (missing.length > 0) {
    return {
      ok: false,
      duration_ms: Date.now() - started,
      error: `Secrets manquants : ${missing.join(', ')}`,
    };
  }

  const form = new URLSearchParams();
  form.set('grant_type', 'password');
  form.set('client_id', clientId!);
  form.set('client_secret', clientSecret!);
  form.set('username', username!);
  form.set('password', password!);
  form.set('scope', 'api');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
      signal: controller.signal,
    });
    const http_status = res.status;
    let text = '';
    try { text = await res.text(); } catch (_e) { /* ignore */ }
    const duration_ms = Date.now() - started;

    if (!res.ok) {
      return {
        ok: false,
        http_status,
        duration_ms,
        error: `Échec ticket OAuth (HTTP ${http_status})`,
        preview: text.slice(0, 500),
      };
    }
    try {
      const json = JSON.parse(text);
      const token = json?.access_token;
      if (!token) {
        return { ok: false, http_status, duration_ms, error: 'Réponse ticket sans access_token.', preview: text.slice(0, 500) };
      }
      return { ok: true, http_status, duration_ms, token };
    } catch (_e) {
      return { ok: false, http_status, duration_ms, error: 'Réponse ticket non JSON.', preview: text.slice(0, 500) };
    }
  } catch (e: any) {
    const duration_ms = Date.now() - started;
    const isTimeout = e?.name === 'AbortError';
    return {
      ok: false,
      duration_ms,
      error: isTimeout ? `timeout (${TIMEOUT_MS / 1000}s dépassé)` : (e?.message ?? String(e)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

type FeedResult = {
  name: string;
  url: string;
  ok: boolean;
  http_status?: number;
  duration_ms: number;
  columns?: string[];
  sample?: any[];
  error?: string;
  preview?: string;
  format?: 'json' | 'xml' | 'text';
};

async function fetchFeed(name: string, url: string, token: string): Promise<FeedResult> {
  const started = Date.now();
  const fullUrl = url + (url.includes('?') ? '&' : '?') + '$top=2';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const http_status = res.status;
    const contentType = res.headers.get('content-type') ?? '';
    let text = '';
    try { text = await res.text(); } catch (_e) { /* ignore */ }
    const duration_ms = Date.now() - started;

    if (!res.ok) {
      return {
        name, url: fullUrl, ok: false, http_status, duration_ms,
        error: http_status === 401 ? 'Non autorisé (401).' : `HTTP ${http_status}`,
        preview: text.slice(0, 500),
      };
    }

    if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        const json = JSON.parse(text);
        const records: any[] = Array.isArray(json) ? json
          : Array.isArray(json.value) ? json.value
          : Array.isArray(json.d) ? json.d
          : Array.isArray(json?.d?.results) ? json.d.results : [];
        const columns = records.length > 0 && records[0] && typeof records[0] === 'object'
          ? Object.keys(records[0]) : [];
        return { name, url: fullUrl, ok: true, http_status, duration_ms, format: 'json', columns, sample: records.slice(0, 2) };
      } catch (_e) {
        return { name, url: fullUrl, ok: true, http_status, duration_ms, format: 'text', preview: text.slice(0, 1000) };
      }
    }
    return { name, url: fullUrl, ok: true, http_status, duration_ms, format: 'xml', preview: text.slice(0, 1000) };
  } catch (e: any) {
    const duration_ms = Date.now() - started;
    const isTimeout = e?.name === 'AbortError';
    return {
      name, url: fullUrl, ok: false, duration_ms,
      error: isTimeout ? `timeout (${TIMEOUT_MS / 1000}s dépassé)` : (e?.message ?? String(e)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- SYNC helpers ----------

const trim = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
const str = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length ? s : null;
};
const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const intNum = (v: any): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
const bool = (v: any): boolean | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase().trim();
  if (['true', '1', 'yes', 'oui', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'non', 'n'].includes(s)) return false;
  return null;
};
const date = (v: any): string | null => {
  if (!v) return null;
  const s = String(v);
  // OData often: "2024-05-12T00:00:00" or "/Date(1234567890000)/"
  const m = s.match(/\/Date\((-?\d+)\)\//);
  if (m) {
    const d = new Date(parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : null;
};

type Mapper = (row: any) => Record<string, any>;

const MAPPERS: Record<string, { table: string; map: Mapper; pk?: string }> = {
  'BD-Clients': {
    table: 'gaia_clients',
    pk: 'customer_id',
    map: (r) => ({
      customer_id: trim(r.CustomerID),
      name: str(r.CustomerName),
      status: str(r.CustomerStatus),
      typologie: str(r.Typologiedeclient ?? r['Typologiedeclient']),
    }),
  },
  'BD-Ventes': {
    table: 'gaia_ventes',
    map: (r) => ({
      code_client: str(r.CodeClient),
      n_fact: str(r.NFactAvoir),
      code_article: trim(r.CodeArticle),
      invoice_date: date(r.InvoiceDate),
      qty: num(r.Qte),
      pu_rem: num(r.PURem),
      montant_ht: num(r.MontantHTRemTot),
      tran_type: str(r.TranType),
      reference_nbr: str(r.ReferenceNbr),
      line_nbr: intNum(r.LineNbr),
      classe_client: str(r.ClassID),
      classe_article: trim(r.ClassID_2),
      vendeur: str(r.SalespersonID),
      branch: str(r.BranchID),
      inventory_id: trim(r.InventoryID),
      devise: str(r.CuryID),
    }),
  },
  'BD-Historique': {
    table: 'gaia_historique',
    map: (r) => ({
      code_client: str(r.CodeClient),
      n_cde: str(r.NCde),
      code_article: trim(r.CodeArticle),
      invoice_date: date(r.InvoiceDate),
      qty: num(r.Qty),
      pu_rem: num(r.PURem),
      montant_ht: num(r.MontantHTRemTot),
      order_type: str(r.OrderType),
      order_nbr: str(r.OrderNbr),
      line_nbr: intNum(r.LineNbr),
      classe_client: str(r.ClassID),
      classe_article: str(r.ClassID_2),
      branch: str(r.BranchID),
      inventory_id: trim(r.InventoryID),
      devise: str(r.CuryID),
    }),
  },
  'BD-Commandes': {
    table: 'gaia_commandes',
    map: (r) => ({
      code_client: str(r.CodeClient),
      type_cde: str(r.TypeCde),
      n_cde: str(r.NCde),
      code_article: trim(r.CodeArticle),
      invoice_date: date(r.InvoiceDate),
      qty: num(r.Qty),
      unit_cost: num(r.UnitCost),
      pu_rem: num(r.PURem),
      montant_ht: num(r.MontantHTRemTot),
      marge_brut: num(r.MargeBrut),
      statut: str(r.Status),
      date_liv: date(r['DateLivEstimée'] ?? r.DateLivEstimee ?? r.DateLivEstim_e),
      completed: bool(r.Completed),
      order_type: str(r.OrderType),
      order_nbr: str(r.OrderNbr),
      line_nbr: intNum(r.LineNbr),
      classe_client: str(r.ClassID),
      classe_article: str(r.ClassID_2),
      branch: str(r.BranchID),
      inventory_id: trim(r.InventoryID),
      devise: str(r.CuryID),
    }),
  },
  'BD-Stock': {
    table: 'gaia_stock',
    map: (r) => ({
      inventory_id: trim(r.InventoryID),
      description: str(r.Description),
      item_status: str(r.ItemStatus),
      item_class: trim(r.ItemClass),
      famille2: str(r.Jeuxfamille2),
      famille3: str(r.Jeuxfamille3),
      warehouse: trim(r.Warehouse),
      qty_on_hand: num(r.QtyOnHand),
      qty_available: num(r.QtyAvailable),
      cout_stock: num(r['Coûtdustock'] ?? r.Coutdustock),
      dernier_cout: num(r['DernierCoûtRevient'] ?? r.DernierCoutRevient),
      prix_vente: num(r.DefaultPrice),
    }),
  },
};

async function fetchAllRows(url: string, token: string): Promise<any[]> {
  const all: any[] = [];
  let skip = 0;
  // safety cap to avoid infinite loops
  for (let page = 0; page < 200; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const pageUrl = `${url}${sep}$top=${PAGE_SIZE}&$skip=${skip}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let text = '';
    let res: Response;
    try {
      res = await fetch(pageUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      text = await res.text();
    } catch (e: any) {
      const isTimeout = e?.name === 'AbortError';
      throw new Error(isTimeout ? `timeout (${TIMEOUT_MS / 1000}s) sur $skip=${skip}` : (e?.message ?? String(e)));
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} sur $skip=${skip} — ${text.slice(0, 200)}`);
    }
    let json: any;
    try { json = JSON.parse(text); } catch (_e) {
      throw new Error(`Réponse non JSON sur $skip=${skip}`);
    }
    const rows: any[] = Array.isArray(json) ? json
      : Array.isArray(json.value) ? json.value
      : Array.isArray(json.d) ? json.d
      : Array.isArray(json?.d?.results) ? json.d.results : [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

type SyncSummary = {
  feed: string;
  rows: number;
  ok: boolean;
  error?: string;
  duration_ms: number;
};

async function syncFeed(
  admin: any,
  feedName: string,
  feedUrl: string,
  token: string,
): Promise<SyncSummary> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const mapper = MAPPERS[feedName];
  if (!mapper) {
    return { feed: feedName, rows: 0, ok: false, error: 'Mapper introuvable', duration_ms: 0 };
  }

  try {
    const raw = await fetchAllRows(feedUrl, token);
    const rows = raw.map(mapper.map).filter((r) => {
      // drop rows where PK-ish field is empty for tables that need it
      if (feedName === 'BD-Clients') return !!r.customer_id;
      return true;
    });

    // Full-refresh: DELETE all then INSERT (PostgREST requires a filter)
    const del = mapper.pk
      ? await admin.from(mapper.table).delete().neq(mapper.pk, '__never_matches__')
      : await admin.from(mapper.table).delete().gte('id', 0);
    if (del.error) throw new Error(`DELETE ${mapper.table}: ${del.error.message}`);

    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const ins = await admin.from(mapper.table).insert(batch);
      if (ins.error) throw new Error(`INSERT ${mapper.table} (batch ${i}): ${ins.error.message}`);
    }

    const duration_ms = Date.now() - started;
    await admin.from('gaia_sync_log').insert({
      feed: feedName,
      rows_loaded: rows.length,
      ok: true,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    return { feed: feedName, rows: rows.length, ok: true, duration_ms };
  } catch (e: any) {
    const duration_ms = Date.now() - started;
    const msg = e?.message ?? String(e);
    try {
      await admin.from('gaia_sync_log').insert({
        feed: feedName,
        rows_loaded: 0,
        ok: false,
        error: msg.slice(0, 1000),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    } catch (_e) { /* ignore log failure */ }
    return { feed: feedName, rows: 0, ok: false, error: msg, duration_ms };
  }
}

// ---------- HTTP handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const userId = userData.user.id;

    const { data: roleRow, error: roleErr } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleErr || !roleRow) {
      return jsonResponse({ error: 'Forbidden: admin only' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const action = body?.action;

    if (action !== 'discover' && action !== 'sync') {
      return jsonResponse({
        token_step: { ok: false, duration_ms: 0, error: `Unknown action: ${action}` },
        feeds: [],
      }, 200);
    }

    // Étape 1 : ticket
    let token_step: TokenStep;
    try {
      token_step = await fetchToken();
    } catch (e: any) {
      token_step = { ok: false, duration_ms: 0, error: e?.message ?? String(e) };
    }

    if (!token_step.ok || !token_step.token) {
      const { token: _t, ...safe } = token_step;
      return jsonResponse({ token_step: safe, feeds: [], summary: [] }, 200);
    }

    if (action === 'discover') {
      let feeds: FeedResult[] = [];
      try {
        feeds = await Promise.all(FEEDS.map((f) => fetchFeed(f.name, f.url, token_step.token!)));
      } catch (e: any) {
        feeds = FEEDS.map((f) => ({
          name: f.name, url: f.url, ok: false, duration_ms: 0,
          error: e?.message ?? String(e),
        }));
      }
      const { token: _t, ...safeToken } = token_step;
      return jsonResponse({ token_step: safeToken, feeds }, 200);
    }

    // action === 'sync'
    const admin = createClient(supabaseUrl, serviceKey);
    const summary: SyncSummary[] = [];
    for (const f of FEEDS) {
      const s = await syncFeed(admin, f.name, f.url, token_step.token!);
      summary.push(s);
    }
    const { token: _t, ...safeToken } = token_step;
    return jsonResponse({ token_step: safeToken, summary }, 200);
  } catch (e: any) {
    console.error('cegid-sync error', e);
    return jsonResponse({
      token_step: { ok: false, duration_ms: 0, error: e?.message ?? String(e) },
      feeds: [],
      summary: [],
    }, 200);
  }
});
