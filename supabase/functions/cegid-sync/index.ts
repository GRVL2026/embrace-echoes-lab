import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

async function fetchFeed(name: string, url: string, auth: string) {
  const fullUrl = url + (url.includes('?') ? '&' : '?') + '$top=2';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const status = res.status;
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();

    if (!res.ok) {
      return {
        name,
        url: fullUrl,
        status,
        ok: false,
        error: status === 401 ? 'Identifiants Cegid invalides (401).' : `HTTP ${status}`,
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
          status,
          ok: true,
          format: 'json' as const,
          columns,
          sample: records.slice(0, 2),
        };
      } catch (_e) {
        return {
          name,
          url: fullUrl,
          status,
          ok: true,
          format: 'text' as const,
          preview: text.slice(0, 1000),
        };
      }
    }

    return {
      name,
      url: fullUrl,
      status,
      ok: true,
      format: 'xml' as const,
      preview: text.slice(0, 1000),
    };
  } catch (e: any) {
    return {
      name,
      url: fullUrl,
      status: 0,
      ok: false,
      error: e?.name === 'AbortError' ? 'Timeout (20s dépassé).' : (e?.message ?? String(e)),
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

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
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
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    const user = Deno.env.get('CEGID_ODATA_USER');
    const pass = Deno.env.get('CEGID_ODATA_PASSWORD');
    if (!user || !pass) {
      return jsonResponse({ error: 'Secrets CEGID_ODATA_USER / CEGID_ODATA_PASSWORD non configurés.' }, 500);
    }
    const auth = btoa(`${user}:${pass}`);

    const results = await Promise.all(FEEDS.map((f) => fetchFeed(f.name, f.url, auth)));

    return jsonResponse({ ok: true, results });
  } catch (e: any) {
    console.error('cegid-sync error', e);
    return jsonResponse({ error: e?.message ?? String(e) }, 500);
  }
});
