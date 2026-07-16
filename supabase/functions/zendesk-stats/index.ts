import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireRole } from '../_shared/require-role.ts';

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
  const transcript = comments.map((c: any) => {
    const role = c.author_role === 'end-user' ? 'CLIENT' : 'AGENT';
    return `[${role} — ${c.author_name} — ${new Date(c.created_at).toLocaleString('fr-FR')}]\n${c.plain_body}`;
  }).join('\n\n---\n\n');

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

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'build_resume' },
      messages: [{ role: 'user', content: prompt.slice(0, 60000) }],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Anthropic ${r.status}: ${body.slice(0, 300)}`);
  }
  const j = await r.json();
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
      const payload = await fetchTicket(id);
      return new Response(JSON.stringify(payload), {
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
