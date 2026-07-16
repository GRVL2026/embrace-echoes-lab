import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUB = Deno.env.get('ZENDESK_SUBDOMAIN') || '';
const EMAIL = Deno.env.get('ZENDESK_EMAIL') || '';
const TOKEN = Deno.env.get('ZENDESK_API_TOKEN') || '';

const CACHE_MINUTES = 15;
const CACHE_VERSION = 1;

function authHeader() {
  const raw = `${EMAIL}/token:${TOKEN}`;
  return `Basic ${btoa(raw)}`;
}

async function zd(path: string): Promise<any> {
  const url = `https://${SUB}.zendesk.com${path}`;
  const r = await fetch(url, {
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Zendesk ${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function fetchAll() {
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date();
  startOfMonth.setDate(startOfMonth.getDate() - 30);
  const isoWeek = startOfWeek.toISOString().slice(0, 10);
  const isoMonth = startOfMonth.toISOString().slice(0, 10);

  // Ticket counts by status
  const countQ = async (q: string) => {
    try {
      const j = await zd(`/api/v2/search/count.json?query=${encodeURIComponent(q)}`);
      return Number(j.count ?? 0);
    } catch {
      return 0;
    }
  };

  const [nouveaux, ouverts, enAttente, resolusSemaine, resolusMois] = await Promise.all([
    countQ('type:ticket status:new'),
    countQ('type:ticket status:open'),
    countQ('type:ticket status:pending'),
    countQ(`type:ticket status:solved solved>${isoWeek}`),
    countQ(`type:ticket status:solved solved>${isoMonth}`),
  ]);

  // Priority breakdown (across open + pending + new)
  const [urgent, high, normal, low] = await Promise.all([
    countQ('type:ticket status<solved priority:urgent'),
    countQ('type:ticket status<solved priority:high'),
    countQ('type:ticket status<solved priority:normal'),
    countQ('type:ticket status<solved priority:low'),
  ]);

  // Latest 20 tickets with users sideload
  const latest = await zd('/api/v2/tickets.json?sort_by=created_at&sort_order=desc&per_page=20&include=users');
  const usersById: Record<string, any> = {};
  for (const u of latest.users ?? []) usersById[String(u.id)] = u;
  const tickets = (latest.tickets ?? []).slice(0, 20).map((t: any) => ({
    id: t.id,
    subject: t.subject || t.raw_subject || '(sans sujet)',
    requester: usersById[String(t.requester_id)]?.name || 'Inconnu',
    status: t.status,
    priority: t.priority,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));

  // Avg first reply time on 30 days
  let avgFirstReplyMinutes: number | null = null;
  try {
    const ids = tickets.map((t: any) => t.id).slice(0, 20);
    if (ids.length) {
      const metrics = await zd(`/api/v2/ticket_metrics.json?page[size]=100`);
      const map = new Map<number, number>();
      for (const m of metrics.ticket_metrics ?? []) {
        if (m.reply_time_in_minutes?.calendar != null) {
          map.set(m.ticket_id, m.reply_time_in_minutes.calendar);
        }
      }
      const vals = ids.map((id) => map.get(id)).filter((v): v is number => typeof v === 'number');
      if (vals.length) avgFirstReplyMinutes = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  } catch {
    avgFirstReplyMinutes = null;
  }

  return {
    subdomain: SUB,
    kpi: { nouveaux, ouverts, enAttente, resolusSemaine, resolusMois },
    priority: { urgent, high, normal, low },
    tickets,
    avgFirstReplyMinutes,
    fetched_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!SUB || !EMAIL || !TOKEN) {
      return new Response(
        JSON.stringify({ error: 'Secrets Zendesk manquants (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN).' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const url = new URL(req.url);
    const force = url.searchParams.get('refresh') === '1';
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!force) {
      const { data: cached } = await supabase
        .from('zendesk_stats_cache')
        .select('payload, fetched_at')
        .eq('cache_version', CACHE_VERSION)
        .eq('period_key', 'default')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached && cached.fetched_at) {
        const age = (Date.now() - new Date(cached.fetched_at).getTime()) / 1000 / 60;
        if (age < CACHE_MINUTES) {
          return new Response(JSON.stringify({ ...(cached.payload as any), cached: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const payload = await fetchAll();
    await supabase.from('zendesk_stats_cache').upsert(
      { period_key: 'default', cache_version: CACHE_VERSION, payload, fetched_at: payload.fetched_at },
      { onConflict: 'period_key,cache_version' },
    );

    return new Response(JSON.stringify({ ...payload, cached: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const isAuth = /401|403|Couldn't authenticate/i.test(msg);
    return new Response(
      JSON.stringify({
        error: isAuth
          ? "Authentification Zendesk refusée. Vérifiez ZENDESK_SUBDOMAIN, ZENDESK_EMAIL et ZENDESK_API_TOKEN."
          : msg,
      }),
      { status: isAuth ? 401 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
