import { createClient } from 'npm:@supabase/supabase-js@2';
import { scheduleSelfInvoke } from '../_shared/self-invoke.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOKEN_URL = 'https://xrp-flex.cegid.cloud/avranches-automatic/identity/connect/token';
const TIMEOUT_MS = 25000;
const PAGE_SIZE = 2000;
const INSERT_BATCH = 500;
const PAGES_PER_INVOCATION = 3;

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
      name: trim(r.CustomerName),
      status: trim(r.CustomerStatus),
      typologie: trim(r.Typologiedeclient ?? r['Typologiedeclient']),
    }),
  },
  'BD-Ventes': {
    table: 'gaia_ventes',
    map: (r) => {
      // Tolerant key lookup for the new margin columns added by Romain.
      // Cegid OData renames français en supprimant espaces/accents ; on tente
      // toutes les variantes plausibles.
      const pickKey = (obj: any, candidates: string[]): any => {
        if (!obj || typeof obj !== 'object') return undefined;
        for (const k of candidates) if (k in obj) return obj[k];
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase();
        const target = candidates.map(norm);
        for (const key of Object.keys(obj)) {
          if (target.includes(norm(key))) return obj[key];
        }
        return undefined;
      };
      return {
        code_client: trim(r.CodeClient),
        n_fact: trim(r.NFactAvoir),
        code_article: trim(r.CodeArticle),
        invoice_date: date(r.InvoiceDate),
        qty: num(r.Qte),
        pu_rem: num(r.PURem),
        montant_ht: num(r.MontantHTRemTot),
        tran_type: trim(r.TranType),
        reference_nbr: trim(r.ReferenceNbr),
        line_nbr: intNum(r.LineNbr),
        classe_client: trim(r.ClassID),
        classe_article: trim(r.ClassID_2),
        vendeur: trim(r.SalespersonID),
        branch: trim(r.BranchID),
        inventory_id: trim(r.InventoryID),
        devise: trim(r.CuryID),
        cout_total: num(pickKey(r, ['CoutTotal', 'CoûtTotal', 'Coûttotal', 'Couttotal', 'Cout total', 'Coût total'])),
        marge_ligne: num(pickKey(r, ['Margeligne', 'MargeEnLigne', 'Margeenligne', 'Marge en ligne', 'MargeLigne'])),
        taux_marque: num(pickKey(r, ['Tauxdemarqueligne', 'TauxDeMarqueLigne', 'TauxDeMarque', 'Tauxdemarque', 'Taux de marque', 'TauxMarque'])),
      };
    },
  },

  'BD-Historique': {
    table: 'gaia_historique',
    map: (r) => ({
      code_client: trim(r.CodeClient),
      n_cde: trim(r.NCde),
      code_article: trim(r.CodeArticle),
      invoice_date: date(r.InvoiceDate),
      qty: num(r.Qty),
      pu_rem: num(r.PURem),
      montant_ht: num(r.MontantHTRemTot),
      order_type: trim(r.OrderType),
      order_nbr: trim(r.OrderNbr),
      line_nbr: intNum(r.LineNbr),
      classe_client: trim(r.ClassID),
      classe_article: trim(r.ClassID_2),
      branch: trim(r.BranchID),
      inventory_id: trim(r.InventoryID),
      devise: trim(r.CuryID),
    }),
  },
  'BD-Commandes': {
    table: 'gaia_commandes',
    map: (r) => {
      // Résilient aux clés à accents / variantes d'encodage OData
      const pickKey = (obj: any, candidates: string[]): any => {
        if (!obj || typeof obj !== 'object') return undefined;
        for (const k of candidates) {
          if (k in obj) return obj[k];
        }
        // fallback : recherche insensible aux accents/casse
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const target = candidates.map(norm);
        for (const key of Object.keys(obj)) {
          if (target.includes(norm(key))) return obj[key];
        }
        return undefined;
      };
      return {
        code_client: trim(r?.CodeClient),
        type_cde: trim(r?.TypeCde),
        n_cde: trim(r?.NCde),
        code_article: trim(r?.CodeArticle),
        invoice_date: date(r?.InvoiceDate),
        qty: num(r?.Qty),
        unit_cost: num(r?.UnitCost),
        pu_rem: num(r?.PURem),
        montant_ht: num(r?.MontantHTRemTot),
        marge_brut: num(r?.MargeBrut),
        statut: trim(r?.Status),
        date_liv: date(pickKey(r, ['DateLivEstimée', 'DateLivEstimee', 'DateLivEstim_e', 'DateLivEstimC3A9e'])),
        completed: bool(r?.Completed),
        order_type: trim(r?.OrderType),
        order_nbr: trim(r?.OrderNbr),
        line_nbr: intNum(r?.LineNbr),
        classe_client: trim(r?.ClassID),
        classe_article: trim(r?.ClassID_2),
        branch: trim(r?.BranchID),
        inventory_id: trim(r?.InventoryID),
        devise: trim(r?.CuryID),
      };
    },
  },
  'BD-Stock': {
    table: 'gaia_stock',
    map: (r) => {
      // Sous-familles ERP par domaine — les noms techniques Cegid varient selon
      // la casse et l'espacement du libellé source. On tente plusieurs variantes
      // pour rester tolérant à un futur renommage du flux.
      const jeux = trim(r.Jeuxfamille2 ?? r['Jeux famille 2'] ?? r.JeuxFamille2);
      const magasin = trim(r.Magasinfamille2 ?? r['Magasin famille 2'] ?? r.MagasinFamille2);
      const atelier = trim(r.Atelierfamille2 ?? r['Atelier famille 2'] ?? r.AtelierFamille2);
      const divers = trim(r.Diversfamille2 ?? r['Divers famille 2'] ?? r.DiversFamille2);
      // famille2 unifiée : jeux prioritaire, sinon la sous-famille du domaine correspondant
      const famille2 = jeux || magasin || atelier || divers || '';
      return {
        inventory_id: trim(r.InventoryID),
        description: trim(r.Description),
        item_status: trim(r.ItemStatus),
        item_class: trim(r.ItemClass),
        famille2,
        famille3: trim(r.Jeuxfamille3),
        magasin_famille2: magasin,
        atelier_famille2: atelier,
        divers_famille2: divers,
        warehouse: trim(r.Warehouse),
        qty_on_hand: num(r.QtyOnHand),
        qty_available: num(r.QtyAvailable),
        cout_stock: num(r['Coûtdustock'] ?? r.Coutdustock),
        dernier_cout: num(r['DernierCoûtRevient'] ?? r.DernierCoutRevient),
        prix_vente: num(r.DefaultPrice),
      };
    },
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
  done?: boolean;
  next_skip?: number;
  total_rows?: number;
  started_at?: string;
};

async function syncFeedChunk(
  admin: any,
  feedName: string,
  feedUrl: string,
  token: string,
  options: { skip: number; reset: boolean; totalRows: number; startedAt?: string },
): Promise<SyncSummary> {
  const started = Date.now();
  const startedAt = options.startedAt ?? new Date().toISOString();
  const mapper = MAPPERS[feedName];
  if (!mapper) {
    return { feed: feedName, rows: 0, ok: false, error: 'Mapper introuvable', duration_ms: 0 };
  }

  let chunkRows = 0;
  let skip = options.skip;
  let done = false;
  try {
    // Full-refresh uniquement au premier morceau. Les appels suivants reprennent au curseur reçu.
    if (options.reset) {
      try {
        const del = mapper.pk
          ? await admin.from(mapper.table).delete().neq(mapper.pk, '__never_matches__')
          : await admin.from(mapper.table).delete().gte('id', 0);
        if (del.error) throw new Error(`DELETE ${mapper.table}: ${del.error.message}`);
      } catch (e: any) {
        throw new Error(`DELETE ${mapper.table}: ${e?.message ?? String(e)}`);
      }
    }

    let pendingBuffer: any[] = [];

    const flushBuffer = async (flushAll = false) => {
      while (pendingBuffer.length >= INSERT_BATCH || (flushAll && pendingBuffer.length > 0)) {
        const batch = pendingBuffer.slice(0, INSERT_BATCH);
        pendingBuffer = pendingBuffer.slice(INSERT_BATCH);
        try {
          const ins = await admin.from(mapper.table).insert(batch);
          if (ins.error) throw new Error(ins.error.message);
          chunkRows += batch.length;
        } catch (e: any) {
          throw new Error(`INSERT ${mapper.table}: ${e?.message ?? String(e)}`);
        }
      }
    };

    // Un appel traite au plus quelques pages afin de rester largement sous la limite de 150 s.
    for (let page = 0; page < PAGES_PER_INVOCATION; page++) {
      const sep = feedUrl.includes('?') ? '&' : '?';
      const pageUrl = `${feedUrl}${sep}$top=${PAGE_SIZE}&$skip=${skip}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let rows: any[] = [];
      try {
        const res = await fetch(pageUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} sur $skip=${skip} — ${text.slice(0, 200)}`);
        }
        let json: any;
        try { json = JSON.parse(text); } catch (_e) {
          throw new Error(`Réponse non JSON sur $skip=${skip}`);
        }
        rows = Array.isArray(json) ? json
          : Array.isArray(json.value) ? json.value
          : Array.isArray(json.d) ? json.d
          : Array.isArray(json?.d?.results) ? json.d.results : [];
      } catch (e: any) {
        const isTimeout = e?.name === 'AbortError';
        throw new Error(isTimeout ? `timeout (${TIMEOUT_MS / 1000}s) sur $skip=${skip}` : (e?.message ?? String(e)));
      } finally {
        clearTimeout(timeout);
      }

      const mapped = rows.map(mapper.map).filter((r) => {
        if (feedName === 'BD-Clients') return !!r.customer_id;
        return true;
      });
      pendingBuffer.push(...mapped);
      await flushBuffer();

      skip += rows.length;
      if (rows.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }

    await flushBuffer(true);

    const duration_ms = Date.now() - started;
    const totalRows = options.totalRows + chunkRows;
    if (done) {
      try {
        await admin.from('gaia_sync_log').insert({
          feed: feedName,
          rows_loaded: totalRows,
          ok: true,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
        });
      } catch (_e) { /* ignore log failure */ }
    }
    return {
      feed: feedName,
      rows: chunkRows,
      total_rows: totalRows,
      ok: true,
      done,
      next_skip: skip,
      started_at: startedAt,
      duration_ms,
    };
  } catch (e: any) {
    const duration_ms = Date.now() - started;
    const msg = e?.message ?? String(e);
    try {
      await admin.from('gaia_sync_log').insert({
        feed: feedName,
        rows_loaded: options.totalRows + chunkRows,
        ok: false,
        error: msg.slice(0, 1000),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    } catch (_e) { /* ignore log failure */ }
    return {
      feed: feedName,
      rows: chunkRows,
      total_rows: options.totalRows + chunkRows,
      ok: false,
      done: true,
      next_skip: skip,
      started_at: startedAt,
      error: msg,
      duration_ms,
    };
  }
}


// ---------- HTTP handler ----------

const SELF_INVOKE_BUDGET_MS = 90_000;

async function resolveCronSecrets(): Promise<string[]> {
  const secrets: string[] = [];
  const envSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (envSecret) secrets.push(envSecret);
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data } = await admin.from('gaia_config').select('value').eq('key', 'cron_secret').maybeSingle();
    const v = (data?.value ?? '') as string;
    if (v && !secrets.includes(v)) secrets.push(v);
  } catch { /* ignore */ }
  return secrets;
}

async function resolveCronSecret(): Promise<string | null> {
  const s = await resolveCronSecrets();
  return s[0] ?? null;
}

async function authorize(req: Request): Promise<
  | { ok: true; viaCron: true }
  | { ok: true; viaCron: false; userId: string }
  | { ok: false; status: number; error: string }
> {
  const cronHeader = req.headers.get('x-cron-secret');
  const authHeader = req.headers.get('Authorization');
  const hasBearer = !!authHeader?.startsWith('Bearer ');

  if (cronHeader) {
    const secrets = await resolveCronSecrets();
    if (secrets.some((s) => s === cronHeader)) {
      return { ok: true, viaCron: true };
    }
    if (!hasBearer) {
      return { ok: false, status: 403, error: 'x-cron-secret invalide' };
    }
    // sinon on tente l'auth JWT ci-dessous
  }

  if (!hasBearer) {
    return { ok: false, status: 403, error: 'header Authorization Bearer manquant' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return { ok: false, status: 200, error: `Unauthorized: ${userErr?.message ?? 'session invalide'}` };
  }
  const { data: roleRow, error: roleErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle();
  if (roleErr || !roleRow) {
    return { ok: false, status: 403, error: 'Forbidden: admin only' };
  }
  return { ok: true, viaCron: false, userId: userData.user.id };
}


async function selfInvoke(payload: Record<string, unknown>) {
  const cronSecret = (await resolveCronSecret()) ?? '';
  if (!cronSecret) {
    console.error('[cegid-sync] selfInvoke: aucun cron_secret disponible, chaîne interrompue.');
    return;
  }
  console.log(`[cegid-sync] selfInvoke payload=${JSON.stringify(payload)} (secret len=${cronSecret.length})`);
  // Le helper enveloppe l'appel dans EdgeRuntime.waitUntil ⇒ la promesse
  // survit au retour de la fonction courante (indispensable en mode cron où
  // le déclencheur ne maintient pas la connexion).
  scheduleSelfInvoke('cegid-sync', payload, { 'x-cron-secret': cronSecret });
}


// ---------- STATE PERSISTANT (cegid_sync_state) ----------

type SyncState = {
  id: number;
  queue: string[] | null;
  feed: string | null;
  skip: number;
  total_rows: number;
  started_at: string | null;
  locked_until: string | null;
  updated_at: string;
};

async function tryLock(admin: any, ttlSeconds = 100): Promise<SyncState | null> {
  const { data, error } = await admin.rpc('cegid_sync_try_lock', { _ttl_seconds: ttlSeconds });
  if (error) throw new Error(`lock: ${error.message}`);
  return (data as SyncState | null) ?? null;
}

async function persistState(admin: any, patch: Partial<SyncState>) {
  const { error } = await admin.from('cegid_sync_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) console.error('[cegid-sync] persistState error:', error.message);
}

async function releaseLock(admin: any) {
  await persistState(admin, { locked_until: null });
}

async function initState(admin: any, queue: string[]) {
  const { error } = await admin.from('cegid_sync_state').update({
    queue: queue.length ? queue : null,
    feed: null,
    skip: 0,
    total_rows: 0,
    started_at: null,
    updated_at: new Date().toISOString(),
    // Note: on ne touche PAS à locked_until ici — la prise de verrou est faite juste après par tryLock.
  }).eq('id', 1);
  if (error) throw new Error(`initState: ${error.message}`);
}

async function computeStaleQueue(admin: any, thresholdH = 12): Promise<string[]> {
  const feedNames = FEEDS.map((f) => f.name);
  const stale: string[] = [];
  for (const name of feedNames) {
    const { data } = await admin.from('gaia_sync_log')
      .select('finished_at')
      .eq('feed', name).eq('ok', true)
      .order('finished_at', { ascending: false }).limit(1).maybeSingle();
    const last = data?.finished_at ? new Date(data.finished_at as string) : null;
    const ageH = last ? (Date.now() - last.getTime()) / 3_600_000 : Infinity;
    if (ageH > thresholdH) stale.push(name);
  }
  return stale;
}

// Traite l'état courant pendant au plus STEP_BUDGET_MS. Le curseur est persisté
// après CHAQUE chunk. Une mort silencieuse ne perd que le chunk en cours ;
// le cron `cegid-sync-stepper` reprend au prochain passage.
async function runStep(
  admin: any,
  token: string,
  state: SyncState,
  globalStart: number,
): Promise<{ summary: SyncSummary[]; hasWork: boolean }> {
  const STEP_BUDGET_MS = 80_000;
  const summary: SyncSummary[] = [];
  let cur = state;

  while (Date.now() - globalStart < STEP_BUDGET_MS) {
    // 1) Si aucun flux actif, pop le prochain de la queue.
    if (!cur.feed) {
      const q = cur.queue ?? [];
      if (q.length === 0) {
        // Plus rien à faire — on nettoie et on s'arrête.
        await persistState(admin, {
          queue: null, feed: null, skip: 0, total_rows: 0, started_at: null,
        });
        cur = { ...cur, queue: null, feed: null, skip: 0, total_rows: 0, started_at: null };
        return { summary, hasWork: false };
      }
      const nextFeed = q[0];
      await persistState(admin, {
        feed: nextFeed, skip: 0, total_rows: 0, started_at: null,
      });
      cur = { ...cur, feed: nextFeed, skip: 0, total_rows: 0, started_at: null };
    }

    const target = FEEDS.find((f) => f.name === cur.feed);
    if (!target) {
      // Flux inconnu dans la queue → on l'écarte et on continue.
      const q = (cur.queue ?? []).filter((n) => n !== cur.feed);
      await persistState(admin, { queue: q.length ? q : null, feed: null });
      cur = { ...cur, queue: q, feed: null };
      continue;
    }

    const reset = cur.skip === 0;
    console.log(`[cegid-sync][step] ${cur.feed} skip=${cur.skip} reset=${reset}`);
    const s = await syncFeedChunk(admin, target.name, target.url, token, {
      skip: cur.skip,
      reset,
      totalRows: cur.total_rows,
      startedAt: cur.started_at ?? undefined,
    });
    summary.push(s);

    // Prolonge le verrou : on a peut-être encore du travail.
    await persistState(admin, {
      locked_until: new Date(Date.now() + 100_000).toISOString(),
    });

    if (!s.ok) {
      // Continue-on-error : on écarte ce flux et on passe au suivant.
      const q = (cur.queue ?? []).filter((n) => n !== cur.feed);
      await persistState(admin, {
        queue: q.length ? q : null, feed: null, skip: 0, total_rows: 0, started_at: null,
      });
      cur = { ...cur, queue: q, feed: null, skip: 0, total_rows: 0, started_at: null };
      continue;
    }

    if (s.done) {
      if (cur.feed === 'BD-Stock') {
        try {
          const { data: refreshed, error: rerr } = await admin.rpc('refresh_erp_prices');
          if (rerr) console.error('[cegid-sync] refresh_erp_prices error:', rerr.message);
          else console.log(`[cegid-sync] refresh_erp_prices → ${refreshed} produits mis à jour`);
        } catch (e: any) {
          console.error('[cegid-sync] refresh_erp_prices crash:', e?.message ?? String(e));
        }
      }
      const q = (cur.queue ?? []).filter((n) => n !== cur.feed);
      await persistState(admin, {
        queue: q.length ? q : null, feed: null, skip: 0, total_rows: 0, started_at: null,
      });
      cur = { ...cur, queue: q, feed: null, skip: 0, total_rows: 0, started_at: null };
      continue;
    }

    // Flux non terminé : on avance le curseur, on persiste.
    cur = {
      ...cur,
      skip: s.next_skip ?? cur.skip,
      total_rows: s.total_rows ?? cur.total_rows,
      started_at: s.started_at ?? cur.started_at,
    };
    await persistState(admin, {
      skip: cur.skip, total_rows: cur.total_rows, started_at: cur.started_at,
    });
  }

  const hasWork = !!cur.feed || !!(cur.queue && cur.queue.length > 0);
  return { summary, hasWork };
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const globalStart = Date.now();
  let currentFeed = '(unknown)';
  let body: any = {};
  try {
    try { body = await req.json(); } catch (_e) { body = {}; }
    console.log('[cegid-sync] payload reçu:', JSON.stringify(body));

    const auth = await authorize(req);
    if (!auth.ok) {
      return jsonResponse({
        ok: false,
        error: auth.error,
        token_step: { ok: false, duration_ms: 0, error: auth.error },
        feeds: [], summary: [],
      }, auth.status);
    }

    const action = body?.action;

    if (action !== 'discover' && action !== 'sync' && action !== 'sync-all' && action !== 'sync-stale' && action !== 'step') {
      return jsonResponse({
        ok: false,
        error: `Unknown action: ${action}`,
        token_step: { ok: false, duration_ms: 0, error: `Unknown action: ${action}` },
        feeds: [], summary: [],
      }, 200);
    }

    if (action === 'sync') {
      const requestedFeed = body?.feed;
      const acceptedFeeds = FEEDS.map((feed) => feed.name);
      if (typeof requestedFeed !== 'string' || !acceptedFeeds.includes(requestedFeed)) {
        const received = requestedFeed === undefined ? 'undefined' : String(requestedFeed);
        return jsonResponse({
          ok: false,
          error: `feed inconnu: ${received}, attendus: ${acceptedFeeds.join(', ')}`,
          summary: [{
            feed: received,
            rows: 0,
            ok: false,
            error: `feed inconnu: ${received}, attendus: ${acceptedFeeds.join(', ')}`,
            duration_ms: 0,
          }],
        }, 200);
      }
      currentFeed = requestedFeed;
    }

    // Étape 1 : ticket
    let token_step: TokenStep;
    try {
      token_step = await fetchToken();
    } catch (e: any) {
      token_step = { ok: false, duration_ms: 0, error: `${e?.message ?? String(e)}\n${e?.stack ?? ''}` };
    }

    if (!token_step.ok || !token_step.token) {
      const { token: _t, ...safe } = token_step;
      return jsonResponse({ ok: false, token_step: safe, feeds: [], summary: [] }, 200);
    }

    if (action === 'discover') {
      let feeds: FeedResult[] = [];
      try {
        feeds = await Promise.all(FEEDS.map((f) => fetchFeed(f.name, f.url, token_step.token!)));
      } catch (e: any) {
        feeds = FEEDS.map((f) => ({
          name: f.name, url: f.url, ok: false, duration_ms: 0,
          error: `${e?.message ?? String(e)}\n${e?.stack ?? ''}`,
        }));
      }
      const { token: _t, ...safeToken } = token_step;
      return jsonResponse({ ok: true, token_step: safeToken, feeds }, 200);
    }

    const { token: _t, ...safeToken } = token_step;
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (action === 'sync-all' || action === 'sync-stale') {
      // RÈGLE : une invocation = un seul flux max. Dès qu'un flux se termine
      // (succès OU échec), on self-invoke pour le flux suivant dans un isolate
      // frais (budget CPU/mémoire remis à zéro) et on retourne immédiatement.
      const feedNames = FEEDS.map((f) => f.name);

      // Pour sync-stale : ne traiter que les flux dont le dernier succès date de >12h.
      // Le flux ciblé est calculé au démarrage de la chaîne (skip=0, feed non fourni).
      let feedName: string | undefined = typeof body?.feed === 'string' && feedNames.includes(body.feed)
        ? body.feed : undefined;
      let skip = Number.isFinite(Number(body?.skip)) && Number(body.skip) >= 0
        ? Math.trunc(Number(body.skip)) : 0;
      let totalRows = Number.isFinite(Number(body?.total_rows)) && Number(body.total_rows) >= 0
        ? Math.trunc(Number(body.total_rows)) : 0;
      let startedAt: string | undefined = typeof body?.started_at === 'string' ? body.started_at : undefined;

      // Calcule la liste des flux périmés pour sync-stale (au premier appel de la chaîne).
      const staleThresholdH = 12;
      const isStaleMode = action === 'sync-stale';
      let staleQueue: string[] | undefined = Array.isArray(body?.stale_queue)
        ? (body.stale_queue as string[]).filter((n) => feedNames.includes(n))
        : undefined;

      if (isStaleMode && !feedName && !staleQueue) {
        // Recense pour chaque flux le dernier succès.
        const stale: string[] = [];
        for (const name of feedNames) {
          const { data } = await admin.from('gaia_sync_log')
            .select('finished_at')
            .eq('feed', name).eq('ok', true)
            .order('finished_at', { ascending: false }).limit(1).maybeSingle();
          const last = data?.finished_at ? new Date(data.finished_at as string) : null;
          const ageH = last ? (Date.now() - last.getTime()) / 3_600_000 : Infinity;
          if (ageH > staleThresholdH) stale.push(name);
        }
        staleQueue = stale;
        if (staleQueue.length === 0) {
          return jsonResponse({ ok: true, token_step: safeToken, summary: [], stale: [], done: true, note: 'Tous les flux sont frais (<12h).' }, 200);
        }
        feedName = staleQueue[0];
      }

      if (!feedName) {
        feedName = feedNames[0];
      }

      const target = FEEDS.find((f) => f.name === feedName)!;
      currentFeed = feedName;

      // Détermine le flux suivant selon le mode.
      const nextFeedAfter = (current: string): string | null => {
        if (isStaleMode && staleQueue) {
          const idx = staleQueue.indexOf(current);
          return idx >= 0 && idx < staleQueue.length - 1 ? staleQueue[idx + 1] : null;
        }
        const idx = feedNames.indexOf(current);
        return idx >= 0 && idx < feedNames.length - 1 ? feedNames[idx + 1] : null;
      };

      const summary: SyncSummary[] = [];
      // Boucle intra-flux : on chunk le MÊME flux jusqu'à `s.done`, `s.ok=false`,
      // ou dépassement du budget 90s (isolate frais nécessaire pour la suite).
      // On NE passe JAMAIS à un autre flux dans la même invocation.
      while (true) {
        const reset = skip === 0;
        console.log(`[cegid-sync][${action}] ${feedName} skip=${skip} reset=${reset}`);
        const s = await syncFeedChunk(admin, target.name, target.url, token_step.token!, {
          skip, reset, totalRows, startedAt,
        });
        summary.push(s);

        // Continue-on-error : un flux cassé ne bloque plus les suivants.
        if (!s.ok) {
          const nxt = nextFeedAfter(feedName!);
          if (nxt) {
            await selfInvoke({
              action, feed: nxt, skip: 0, total_rows: 0,
              ...(isStaleMode && staleQueue ? { stale_queue: staleQueue } : {}),
            });
            return jsonResponse({ ok: false, token_step: safeToken, summary, continued: true, skipped_after_error: feedName, next: { feed: nxt, skip: 0 } }, 200);
          }
          return jsonResponse({ ok: false, token_step: safeToken, summary, done: true }, 200);
        }

        if (s.done) {
          if (feedName === 'BD-Stock') {
            try {
              const { data: refreshed, error: rerr } = await admin.rpc('refresh_erp_prices');
              if (rerr) console.error('[cegid-sync] refresh_erp_prices error:', rerr.message);
              else console.log(`[cegid-sync] refresh_erp_prices → ${refreshed} produits mis à jour`);
            } catch (e: any) {
              console.error('[cegid-sync] refresh_erp_prices crash:', e?.message ?? String(e));
            }
          }
          const nxt = nextFeedAfter(feedName!);
          if (!nxt) {
            return jsonResponse({ ok: true, token_step: safeToken, summary, done: true }, 200);
          }
          // Isolate frais obligatoire pour le flux suivant.
          await selfInvoke({
            action, feed: nxt, skip: 0, total_rows: 0,
            ...(isStaleMode && staleQueue ? { stale_queue: staleQueue } : {}),
          });
          return jsonResponse({ ok: true, token_step: safeToken, summary, continued: true, next: { feed: nxt, skip: 0 } }, 200);
        }

        // Flux pas terminé : on avance le curseur.
        skip = s.next_skip ?? skip;
        totalRows = s.total_rows ?? totalRows;
        startedAt = s.started_at ?? startedAt;

        // Budget 90s intra-flux : au-delà, self-invoke sur le MÊME flux.
        if (Date.now() - globalStart >= SELF_INVOKE_BUDGET_MS) {
          await selfInvoke({
            action, feed: feedName, skip, total_rows: totalRows, started_at: startedAt,
            ...(isStaleMode && staleQueue ? { stale_queue: staleQueue } : {}),
          });
          return jsonResponse({
            ok: true, token_step: safeToken, summary, continued: true,
            next: { feed: feedName, skip, total_rows: totalRows },
          }, 200);
        }
      }
    }

    // action === 'sync' — un seul flux par appel
    const requestedFeed: string | undefined = body?.feed;
    const target = FEEDS.find((f) => f.name === requestedFeed);
    if (!target) {
      return jsonResponse({
        ok: false,
        token_step: safeToken,
        summary: [{
          feed: requestedFeed, rows: 0, ok: false,
          error: `feed inconnu: ${requestedFeed}, attendus: ${FEEDS.map((feed) => feed.name).join(', ')}`,
          duration_ms: 0,
        }],
      }, 200);
    }

    let s: SyncSummary;
    try {
      const requestedSkip = Number(body?.skip ?? 0);
      const requestedTotal = Number(body?.total_rows ?? 0);
      const skip = Number.isFinite(requestedSkip) && requestedSkip >= 0 ? Math.trunc(requestedSkip) : 0;
      const totalRows = Number.isFinite(requestedTotal) && requestedTotal >= 0 ? Math.trunc(requestedTotal) : 0;
      const reset = body?.reset === true || skip === 0;
      const startedAt = typeof body?.started_at === 'string' ? body.started_at : undefined;
      console.log(`[cegid-sync] début flux ${target.name}, skip=${skip}, reset=${reset}`);
      s = await syncFeedChunk(admin, target.name, target.url, token_step.token!, {
        skip,
        reset,
        totalRows,
        startedAt,
      });
      console.log(`[cegid-sync] fin morceau ${target.name}: ok=${s.ok} rows=${s.rows} total=${s.total_rows} done=${s.done}`);
      if (s.ok && s.done && target.name === 'BD-Stock') {
        try {
          const { data: refreshed, error: rerr } = await admin.rpc('refresh_erp_prices');
          if (rerr) console.error('[cegid-sync] refresh_erp_prices error:', rerr.message);
          else console.log(`[cegid-sync] refresh_erp_prices → ${refreshed} produits mis à jour`);
        } catch (e: any) {
          console.error('[cegid-sync] refresh_erp_prices crash:', e?.message ?? String(e));
        }
      }
    } catch (e: any) {
      const msg = `${e?.message ?? String(e)}\n${e?.stack ?? ''}`;
      console.error(`[cegid-sync] crash flux ${target.name}:`, msg);
      s = { feed: target.name, rows: 0, ok: false, error: msg, duration_ms: 0 };
    }
    return jsonResponse({ ok: s.ok, token_step: safeToken, summary: [s] }, 200);
  } catch (e: any) {
    // Filet de sécurité global — TOUJOURS 200 sauf 403 admin (géré au-dessus).
    const msg = `${e?.message ?? String(e)}\n${e?.stack ?? ''}`;
    console.error('[cegid-sync] crash global:', msg);
    return jsonResponse({
      ok: false,
      error: msg,
      feed: currentFeed,
      token_step: { ok: false, duration_ms: 0, error: msg },
      feeds: [],
      summary: [{ feed: currentFeed, rows: 0, ok: false, error: msg, duration_ms: 0 }],
    }, 200);
  }
});

