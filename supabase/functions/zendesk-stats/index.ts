import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireRole } from '../_shared/require-role.ts';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUB = (Deno.env.get('ZENDESK_SUBDOMAIN') || '')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/\.zendesk\.com.*$/i, '')
  .replace(/\/.*$/, '');
const EMAIL = Deno.env.get('ZENDESK_EMAIL') || '';
const TOKEN = Deno.env.get('ZENDESK_API_TOKEN') || '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

const CACHE_MINUTES = 15;
const CACHE_VERSION = 1;
const ANTHROPIC_MODEL = 'claude-sonnet-5';

function authHeader() {
  return `Basic ${btoa(`${EMAIL}/token:${TOKEN}`)}`;
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

async function fetchUsersByIds(ids: number[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const uniq = Array.from(new Set(ids.filter((x) => x != null)));
  const CHUNK = 100;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    try {
      const j = await zd(`/api/v2/users/show_many.json?ids=${slice.join(',')}`);
      for (const u of j.users ?? []) out[String(u.id)] = u;
    } catch { /* skip */ }
  }
  return out;
}

async function searchTickets(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return { tickets: [] };

  // Direct ticket # lookup when purely numeric
  if (/^\d+$/.test(trimmed)) {
    try {
      const j = await zd(`/api/v2/tickets/${trimmed}.json?include=users`);
      const t = j.ticket;
      const users: Record<string, any> = {};
      for (const u of j.users ?? []) users[String(u.id)] = u;
      if (t) {
        return {
          tickets: [{
            id: t.id,
            subject: t.subject || t.raw_subject || '(sans sujet)',
            requester: users[String(t.requester_id)]?.name
              || (await fetchUsersByIds([t.requester_id]))[String(t.requester_id)]?.name
              || 'Inconnu',
            status: t.status,
            priority: t.priority,
            created_at: t.created_at,
            updated_at: t.updated_at,
          }],
        };
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!/\b404\b/.test(msg)) throw e;
      // fall through to text search
    }
  }

  const query = `type:ticket ${trimmed}`;
  const searchUrl = `/api/v2/search.json?query=${encodeURIComponent(query)}&sort_by=updated_at&sort_order=desc&per_page=25`;
  const j = await zd(searchUrl);
  const rawTickets = (j.results ?? []).filter((r: any) => r.result_type === 'ticket').slice(0, 25);
  const users = await fetchUsersByIds(rawTickets.map((t: any) => t.requester_id));
  const tickets = rawTickets.map((t: any) => ({
    id: t.id,
    subject: t.subject || t.raw_subject || '(sans sujet)',
    requester: users[String(t.requester_id)]?.name || 'Inconnu',
    status: t.status,
    priority: t.priority,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));
  return { tickets };
}

async function computeTopClients() {
  const MAX_PAGES = 10;
  const PAGE_SIZE = 100;
  const agg = new Map<number, { total: number; ouverts: number; enAttente: number }>();
  let cursor: string | null = null;
  let pages = 0;
  let scanned = 0;
  let hasMore = false;

  for (pages = 0; pages < MAX_PAGES; pages++) {
    const path = cursor
      ? `/api/v2/tickets.json?page[size]=${PAGE_SIZE}&page[after]=${encodeURIComponent(cursor)}`
      : `/api/v2/tickets.json?page[size]=${PAGE_SIZE}`;
    const j: any = await zd(path);
    for (const t of j.tickets ?? []) {
      const rid = Number(t.requester_id);
      if (!rid) continue;
      const cur = agg.get(rid) || { total: 0, ouverts: 0, enAttente: 0 };
      cur.total++;
      if (t.status === 'open' || t.status === 'new') cur.ouverts++;
      else if (t.status === 'pending' || t.status === 'hold') cur.enAttente++;
      agg.set(rid, cur);
      scanned++;
    }
    if (j.meta?.has_more && j.links?.next) {
      // Parse the after_cursor from the next link
      try {
        const nextUrl = new URL(j.links.next);
        cursor = nextUrl.searchParams.get('page[after]')
          || nextUrl.searchParams.get('page%5Bafter%5D')
          || null;
      } catch { cursor = null; }
      if (!cursor) break;
      hasMore = true;
    } else {
      hasMore = false;
      break;
    }
  }
  if (pages >= MAX_PAGES && hasMore) hasMore = true; else hasMore = false;

  const top = Array.from(agg.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  const users = await fetchUsersByIds(top.map(([id]) => id));
  const clients = top.map(([id, v], i) => ({
    rank: i + 1,
    requester_id: id,
    name: users[String(id)]?.name || 'Inconnu',
    email: users[String(id)]?.email || null,
    total: v.total,
    ouverts: v.ouverts,
    en_attente: v.enAttente,
  }));

  return {
    clients,
    scanned,
    truncated: hasMore,
    fetched_at: new Date().toISOString(),
  };
}

async function fetchStats() {
  const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(); startOfMonth.setDate(startOfMonth.getDate() - 30);
  const isoWeek = startOfWeek.toISOString().slice(0, 10);
  const isoMonth = startOfMonth.toISOString().slice(0, 10);

  const countQ = async (q: string) => {
    try {
      const j = await zd(`/api/v2/search/count.json?query=${encodeURIComponent(q)}`);
      return Number(j.count ?? 0);
    } catch { return 0; }
  };

  const [nouveaux, ouverts, enAttente, resolusSemaine, resolusMois] = await Promise.all([
    countQ('type:ticket status:new'),
    countQ('type:ticket status:open'),
    countQ('type:ticket status:pending'),
    countQ(`type:ticket status:solved solved>${isoWeek}`),
    countQ(`type:ticket status:solved solved>${isoMonth}`),
  ]);
  const [urgent, high, normal, low] = await Promise.all([
    countQ('type:ticket status<solved priority:urgent'),
    countQ('type:ticket status<solved priority:high'),
    countQ('type:ticket status<solved priority:normal'),
    countQ('type:ticket status<solved priority:low'),
  ]);

  const latest = await zd('/api/v2/tickets.json?sort_by=created_at&sort_order=desc&per_page=20&include=users');
  const usersById: Record<string, any> = {};
  for (const u of latest.users ?? []) usersById[String(u.id)] = u;
  const tickets = (latest.tickets ?? []).slice(0, 20).map((t: any) => ({
    id: t.id, subject: t.subject || t.raw_subject || '(sans sujet)',
    requester: usersById[String(t.requester_id)]?.name || 'Inconnu',
    status: t.status, priority: t.priority,
    created_at: t.created_at, updated_at: t.updated_at,
  }));

  let avgFirstReplyMinutes: number | null = null;
  try {
    const ids = tickets.map((t: any) => t.id).slice(0, 20);
    if (ids.length) {
      const metrics = await zd(`/api/v2/ticket_metrics.json?page[size]=100`);
      const map = new Map<number, number>();
      for (const m of metrics.ticket_metrics ?? []) {
        if (m.reply_time_in_minutes?.calendar != null) map.set(m.ticket_id, m.reply_time_in_minutes.calendar);
      }
      const vals = ids.map((id) => map.get(id)).filter((v): v is number => typeof v === 'number');
      if (vals.length) avgFirstReplyMinutes = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  } catch { avgFirstReplyMinutes = null; }

  return {
    subdomain: SUB,
    kpi: { nouveaux, ouverts, enAttente, resolusSemaine, resolusMois },
    priority: { urgent, high, normal, low },
    tickets, avgFirstReplyMinutes,
    fetched_at: new Date().toISOString(),
  };
}

async function fetchTicket(id: string) {
  const [ticketJson, commentsJson] = await Promise.all([
    zd(`/api/v2/tickets/${id}.json?include=users`),
    zd(`/api/v2/tickets/${id}/comments.json?include=users&sort_order=asc`),
  ]);
  const users: Record<string, any> = {};
  for (const u of [...(ticketJson.users ?? []), ...(commentsJson.users ?? [])]) users[String(u.id)] = u;
  const t = ticketJson.ticket;
  const comments = (commentsJson.comments ?? []).map((c: any) => ({
    id: c.id,
    author_id: c.author_id,
    author_name: users[String(c.author_id)]?.name || 'Inconnu',
    author_role: users[String(c.author_id)]?.role || 'end-user',
    public: c.public,
    created_at: c.created_at,
    plain_body: c.plain_body || '',
    html_body: c.html_body || '',
    attachments: (c.attachments ?? []).map((a: any) => ({
      id: a.id,
      file_name: a.file_name,
      content_url: a.content_url,
      content_type: a.content_type,
      size: a.size,
      thumbnails: a.thumbnails || [],
    })),
  }));
  return {
    ticket: {
      id: t.id, subject: t.subject || t.raw_subject || '(sans sujet)',
      description: t.description,
      status: t.status, priority: t.priority,
      created_at: t.created_at, updated_at: t.updated_at,
      requester_id: t.requester_id,
      requester_name: users[String(t.requester_id)]?.name || 'Inconnu',
      requester_email: users[String(t.requester_id)]?.email || null,
      assignee_name: t.assignee_id ? users[String(t.assignee_id)]?.name || null : null,
      tags: t.tags || [],
    },
    comments,
  };
}

async function fetchSideConversations(ticketId: string): Promise<any[]> {
  const listUrl = `/api/v2/tickets/${ticketId}/side_conversations`;
  let listJson: any;
  try {
    listJson = await zd(listUrl);
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Degrade softly if plan doesn't include Side Conversations
    if (/\b(402|403|404)\b/.test(msg)) return [];
    throw e;
  }
  const scs = listJson.side_conversations ?? [];
  const results = await Promise.all(
    scs.map(async (sc: any) => {
      const scId = sc.id;
      let events: any[] = [];
      try {
        const evJson = await zd(`/api/v2/tickets/${ticketId}/side_conversations/${scId}/events`);
        events = (evJson.events ?? [])
          .filter((ev: any) => ev.type === 'message' || ev.message)
          .map((ev: any) => {
            const m = ev.message || {};
            return {
              id: ev.id,
              created_at: ev.created_at,
              author_name: m.from?.name || m.from?.email || 'Fournisseur',
              author_email: m.from?.email || null,
              to: (m.to || []).map((t: any) => t?.email || t?.name).filter(Boolean),
              cc: (m.cc || []).map((t: any) => t?.email || t?.name).filter(Boolean),
              subject: m.subject || sc.subject || '',
              body: m.body || m.plain_body || m.html_body || '',
            };
          });
      } catch { /* skip broken event fetch */ }
      return {
        id: sc.id,
        subject: sc.subject || '(sans sujet)',
        state: sc.state,
        created_at: sc.created_at,
        updated_at: sc.updated_at,
        participants: (sc.participants ?? []).map((p: any) => ({
          name: p.name || p.email || 'Participant',
          email: p.email || null,
        })),
        events,
      };
    }),
  );
  return results;
}

async function proxyAttachment(rawUrl: string): Promise<Response> {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { return new Response('bad url', { status: 400, headers: corsHeaders }); }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === `${SUB}.zendesk.com` ||
    host.endsWith('.zdusercontent.com');
  if (!allowed) return new Response('forbidden host', { status: 403, headers: corsHeaders });

  const r = await fetch(url.toString(), { headers: { Authorization: authHeader() } });
  if (!r.ok) return new Response(`upstream ${r.status}`, { status: r.status, headers: corsHeaders });
  const contentType = r.headers.get('content-type') || 'application/octet-stream';
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=300',
  };
  const disp = r.headers.get('content-disposition');
  if (disp) headers['Content-Disposition'] = disp;
  return new Response(r.body, { status: 200, headers });
}

async function buildResume(ticketId: string) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY manquant');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const [{ ticket, comments }, side_conversations] = await Promise.all([
    fetchTicket(ticketId),
    fetchSideConversations(ticketId),
  ]);

  // Cache check
  const { data: cached } = await supabase
    .from('zendesk_ticket_summaries')
    .select('resume, ticket_updated_at')
    .eq('ticket_id', Number(ticketId))
    .maybeSingle();
  if (cached && cached.ticket_updated_at === ticket.updated_at) {
    return { resume: cached.resume, cached: true };
  }

  // Compose conversation transcript
  const mainTranscript = comments.map((c: any) => {
    const role = c.author_role === 'end-user' ? 'CLIENT' : 'AGENT';
    const flag = c.public === false ? ' (note interne)' : '';
    return `[${role}${flag} — ${c.author_name} — ${new Date(c.created_at).toLocaleString('fr-FR')}]\n${c.plain_body}`;
  }).join('\n\n---\n\n');

  const supplierTranscript = (side_conversations || []).flatMap((sc: any) =>
    (sc.events || []).map((ev: any) =>
      `[FOURNISSEUR — ${ev.author_name} — ${new Date(ev.created_at).toLocaleString('fr-FR')}]\nSujet: ${ev.subject}\n${(ev.body || '').replace(/<[^>]+>/g, ' ')}`,
    ),
  ).join('\n\n---\n\n');

  const transcript = supplierTranscript
    ? `${mainTranscript}\n\n=== ÉCHANGES FOURNISSEURS ===\n\n${supplierTranscript}`
    : mainTranscript;

  const tool = {
    name: 'build_resume',
    description: 'Résume un ticket SAV Zendesk en français, sous forme structurée.',
    input_schema: {
      type: 'object',
      properties: {
        probleme_rencontre: { type: 'string', description: '2 à 3 phrases décrivant le problème rapporté par le client.' },
        diagnostic: { type: 'string', description: 'Diagnostic technique posé par l\'agent (ou hypothèse si non confirmé).' },
        resolution: { type: 'string', description: 'Résolution appliquée. Si le ticket n\'est pas résolu, écrire "En cours".' },
        pieces_detachees: { type: 'array', items: { type: 'string' }, description: 'Noms des pièces détachées mentionnées (vide si aucune).' },
        machine_concernee: { type: 'string', description: 'Machine ou modèle concerné si identifiable, sinon chaîne vide.' },
      },
      required: ['probleme_rencontre', 'diagnostic', 'resolution', 'pieces_detachees', 'machine_concernee'],
    },
  };

  const prompt =
    `Sujet: ${ticket.subject}\nStatut Zendesk: ${ticket.status}\nPriorité: ${ticket.priority || 'n/a'}\n` +
    `Client: ${ticket.requester_name}\n\n=== FIL DE CONVERSATION ===\n\n${transcript}`;

  const j = await anthropicJson(ANTHROPIC_KEY, {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'build_resume' },
    messages: [{ role: 'user', content: prompt.slice(0, 60000) }],
  });
  const use = (j.content || []).find((b: any) => b.type === 'tool_use');
  if (!use?.input) throw new Error('Réponse Anthropic invalide (pas de tool_use).');
  const resume = use.input;

  await supabase.from('zendesk_ticket_summaries').upsert({
    ticket_id: Number(ticketId),
    ticket_updated_at: ticket.updated_at,
    resume,
    model: ANTHROPIC_MODEL,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'ticket_id' });

  return { resume, cached: false };
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
    const action = url.searchParams.get('action') || 'stats';

    // Auth gate: every action requires admin/direction. JWT via Authorization
    // header, or via ?token= query param for <img>/<a> attachment tags.
    const gate = await requireRole(req, ['admin', 'direction']);
    if (!gate.ok) return gate.response;

    if (action === 'attachment') {
      const src = url.searchParams.get('url');
      if (!src) return new Response('missing url', { status: 400, headers: corsHeaders });
      return await proxyAttachment(src);
    }

    if (action === 'ticket') {
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'missing id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      const [core, side_conversations] = await Promise.all([
        fetchTicket(id),
        fetchSideConversations(id),
      ]);
      return new Response(JSON.stringify({ ...core, side_conversations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'resume') {
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'missing id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      const payload = await buildResume(id);
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'search') {
      const q = url.searchParams.get('q') || '';
      if (!q.trim()) {
        return new Response(JSON.stringify({ tickets: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const payload = await searchTickets(q);
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'top_clients') {
      const force = url.searchParams.get('refresh') === '1';
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      if (!force) {
        const { data: cached } = await supabase
          .from('zendesk_stats_cache')
          .select('payload, fetched_at')
          .eq('cache_version', CACHE_VERSION)
          .eq('period_key', 'top_clients')
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cached?.fetched_at) {
          const age = (Date.now() - new Date(cached.fetched_at).getTime()) / 1000 / 60;
          if (age < 60) {
            return new Response(JSON.stringify({ ...(cached.payload as any), cached: true }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
      const payload = await computeTopClients();
      await supabase.from('zendesk_stats_cache').upsert(
        { period_key: 'top_clients', cache_version: CACHE_VERSION, payload, fetched_at: payload.fetched_at },
        { onConflict: 'period_key,cache_version' },
      );
      return new Response(JSON.stringify({ ...payload, cached: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    // action=stats (default)
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
      if (cached?.fetched_at) {
        const age = (Date.now() - new Date(cached.fetched_at).getTime()) / 1000 / 60;
        if (age < CACHE_MINUTES) {
          return new Response(JSON.stringify({ ...(cached.payload as any), cached: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }
    const payload = await fetchStats();
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
