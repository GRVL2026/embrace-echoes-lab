import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOKEN_URL = 'https://xrp-flex.cegid.cloud/avranches-automatic/identity/connect/token';
const TIMEOUT_MS = 25000;

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
        name,
        url: fullUrl,
        ok: false,
        http_status,
        duration_ms,
        error: http_status === 401 ? 'Non autorisé (401).' : `HTTP ${http_status}`,
        preview: text.slice(0, 500),
      };
    }

    if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        const json = JSON.parse(text);
        const records: any[] = Array.isArray(json)
          ? json
          : Array.isArray(json.value)
            ? json.value
            : Array.isArray(json.d)
              ? json.d
              : Array.isArray(json?.d?.results)
                ? json.d.results
                : [];
        const columns = records.length > 0 && records[0] && typeof records[0] === 'object'
          ? Object.keys(records[0])
          : [];
        return {
          name,
          url: fullUrl,
          ok: true,
          http_status,
          duration_ms,
          format: 'json',
          columns,
          sample: records.slice(0, 2),
        };
      } catch (_e) {
        return {
          name,
          url: fullUrl,
          ok: true,
          http_status,
          duration_ms,
          format: 'text',
          preview: text.slice(0, 1000),
        };
      }
    }

    return {
      name,
      url: fullUrl,
      ok: true,
      http_status,
      duration_ms,
      format: 'xml',
      preview: text.slice(0, 1000),
    };
  } catch (e: any) {
    const duration_ms = Date.now() - started;
    const isTimeout = e?.name === 'AbortError';
    return {
      name,
      url: fullUrl,
      ok: false,
      duration_ms,
      error: isTimeout ? `timeout (${TIMEOUT_MS / 1000}s dépassé)` : (e?.message ?? String(e)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

    if (action !== 'discover') {
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
      return jsonResponse({ token_step: safe, feeds: [] }, 200);
    }

    // Étape 2 : flux
    let feeds: FeedResult[] = [];
    try {
      feeds = await Promise.all(FEEDS.map((f) => fetchFeed(f.name, f.url, token_step.token!)));
    } catch (e: any) {
      feeds = FEEDS.map((f) => ({
        name: f.name,
        url: f.url,
        ok: false,
        duration_ms: 0,
        error: e?.message ?? String(e),
      }));
    }

    const { token: _t, ...safeToken } = token_step;
    return jsonResponse({ token_step: safeToken, feeds }, 200);
  } catch (e: any) {
    console.error('cegid-sync error', e);
    return jsonResponse({
      token_step: { ok: false, duration_ms: 0, error: e?.message ?? String(e) },
      feeds: [],
    }, 200);
  }
});
