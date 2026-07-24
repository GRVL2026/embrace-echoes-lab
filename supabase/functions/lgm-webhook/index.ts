import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('LGM_WEBHOOK_SECRET') ?? '';

const STATUT_ORDER = ['nouveau', 'connecte', 'repondu', 'rdv', 'devis', 'client', 'perdu'];

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pick(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    const parts = p.split('.');
    let cur: any = obj;
    for (const k of parts) {
      if (cur && typeof cur === 'object' && k in cur) cur = cur[k];
      else { cur = null; break; }
    }
    if (cur !== null && cur !== undefined && cur !== '') return String(cur);
  }
  return null;
}

function mapEventToStatut(evt: string): string | null {
  const n = norm(evt);
  if (!n) return null;
  if (n.includes('repl') || n.includes('answer') || n.includes('repond') || n.includes('reply')) return 'repondu';
  if (n.includes('accept') || n.includes('connect')) return 'connecte';
  return null;
}

function forward(current: string, target: string): boolean {
  const ci = STATUT_ORDER.indexOf(current);
  const ti = STATUT_ORDER.indexOf(target);
  if (ti < 0) return false;
  if (ci < 0) return true;
  return ti > ci;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? '';
    if (WEBHOOK_SECRET) {
      if (token !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: 'invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.warn('LGM_WEBHOOK_SECRET not set — accepting without token verification');
    }

    const payload = await req.json().catch(() => ({}));

    const lgmLeadId = pick(payload, ['leadId', 'lead_id', 'id', 'lead.id', 'lead.leadId', 'lead._id']);
    const event = pick(payload, ['event', 'type', 'eventType', 'event_type', 'trigger', 'name']) ?? '';

    // Log brut d'abord
    const { data: logRow } = await admin
      .from('lgm_webhook_log')
      .insert({ payload, event, lgm_lead_id: lgmLeadId, action: 'received' })
      .select('id')
      .single();
    const logId = logRow?.id;

    // Retrouver le prospect
    let prospect: any = null;
    if (lgmLeadId) {
      const { data } = await admin.from('prospects').select('*').eq('lgm_lead_id', lgmLeadId).maybeSingle();
      if (data) prospect = data;
    }
    if (!prospect) {
      const email = pick(payload, ['proEmail', 'persoEmail', 'email', 'lead.proEmail', 'lead.persoEmail', 'lead.email']);
      if (email) {
        const { data } = await admin.from('prospects').select('*').ilike('email', email).limit(1).maybeSingle();
        if (data) prospect = data;
      }
    }
    if (!prospect) {
      const linkedin = pick(payload, ['linkedinUrl', 'linkedin_url', 'lead.linkedinUrl', 'lead.linkedin_url']);
      if (linkedin) {
        const { data } = await admin.from('prospects').select('*').eq('linkedin_url', linkedin).limit(1).maybeSingle();
        if (data) prospect = data;
      }
    }

    if (!prospect) {
      if (logId) await admin.from('lgm_webhook_log').update({ action: 'no_match' }).eq('id', logId);
      return new Response(JSON.stringify({ matched: false, event }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const targetStatut = mapEventToStatut(event);
    const update: Record<string, unknown> = { lgm_status: event || prospect.lgm_status };
    let advanced = false;
    if (targetStatut && forward(prospect.statut, targetStatut)) {
      update.statut = targetStatut;
      advanced = true;
    }
    if (!prospect.lgm_lead_id && lgmLeadId) update.lgm_lead_id = lgmLeadId;

    await admin.from('prospects').update(update).eq('id', prospect.id);

    const desc = advanced
      ? `LGM: ${event || '(sans type)'} → statut ${targetStatut}`
      : `LGM: ${event || '(sans type)'}`;
    await admin.from('prospect_events').insert({
      prospect_id: prospect.id,
      type: 'lgm',
      contenu: desc,
      ancien_statut: advanced ? prospect.statut : null,
      nouveau_statut: advanced ? targetStatut : null,
    });

    const action = advanced ? `advanced:${targetStatut}` : 'logged';
    if (logId) {
      await admin
        .from('lgm_webhook_log')
        .update({ matched_prospect: prospect.id, action })
        .eq('id', logId);
    }

    return new Response(
      JSON.stringify({ matched: true, prospect: prospect.id, event, action }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('lgm-webhook error', (e as Error).message);
    // Toujours 200 pour éviter les retries LGM
    return new Response(
      JSON.stringify({ matched: false, error: (e as Error).message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
