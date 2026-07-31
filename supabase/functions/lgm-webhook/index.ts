import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('LGM_WEBHOOK_SECRET') ?? '';

// Ordre du pipeline. "contacte" = invitation LinkedIn envoyée / prise de contact,
// "connecte" = invitation acceptée (LGM webhook), "repondu" = réponse reçue.
// Les statuts en aval (rdv, devis, client, perdu) restent en base pour l'historique
// et l'attribution CA, même s'ils ne s'affichent plus dans le Kanban.
const STATUT_ORDER = ['nouveau', 'contacte', 'connecte', 'repondu', 'rdv', 'devis', 'client', 'perdu'];

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
  // Réponse / message reçu → repondu
  if (n.includes('repl') || n.includes('answer') || n.includes('repond') || n.includes('reply') || n.includes('message')) return 'repondu';
  // Invitation acceptée / connexion établie → connecte (LinkedIn)
  if (n.includes('accept') || n.includes('connect')) return 'connecte';
  // Invitation envoyée / prise de contact (avant acceptation) → contacte
  if (n.includes('invit') || n.includes('sent') || n.includes('envoy') || n.includes('contact')) return 'contacte';
  return null;
}

function forward(current: string, target: string): boolean {
  const ci = STATUT_ORDER.indexOf(current);
  const ti = STATUT_ORDER.indexOf(target);
  if (ti < 0) return false;
  if (ci < 0) return true;
  return ti > ci;
}

/** Comparaison à temps constant (évite les fuites par timing). */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  // Longueurs différentes : on compare quand même pour un coût ~constant.
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

function clientIp(req: Request): string | null {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? '';
    const ip = clientIp(req);

    // 1) Fail-closed : sans secret configuré, aucune écriture en base, jamais d'acceptation.
    if (!WEBHOOK_SECRET) {
      console.error('lgm-webhook: LGM_WEBHOOK_SECRET manquant');
      return new Response(JSON.stringify({ error: 'webhook non configuré' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Token requis, comparaison à temps constant.
    if (!token || !timingSafeEqual(token, WEBHOOK_SECRET)) {
      const raison = token ? 'token_incorrect' : 'token_absent';
      // 3) Journalise la tentative refusée, sans toucher au moindre prospect.
      await admin.from('lgm_webhook_log').insert({
        payload: { rejete: true, raison, ip, method: req.method, path: url.pathname },
        event: 'rejected',
        lgm_lead_id: null,
        action: `rejete:${raison}${ip ? ` ip=${ip}` : ''}`,
      });
      return new Response(JSON.stringify({ error: 'invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    const payload = await req.json().catch(() => ({}));

    const lgmLeadId = pick(payload, ['crmId', 'identityId', 'leadId', 'lead_id', 'id', 'lead.id', 'lead.leadId', 'lead._id']);
    const event = pick(payload, ['type', 'event', 'eventType', 'event_type', 'trigger', 'name']) ?? '';

    // Log brut d'abord
    const { data: logRow } = await admin
      .from('lgm_webhook_log')
      .insert({ payload, event, lgm_lead_id: lgmLeadId, action: 'received' })
      .select('id')
      .single();
    const logId = logRow?.id;

    // Retrouver le prospect
    let prospect: any = null;

    // 1) Matching par ID LGM : crmId > identityId > autres
    const idCandidates = [
      pick(payload, ['crmId']),
      pick(payload, ['identityId']),
      pick(payload, ['leadId', 'lead_id', 'id', 'lead.id', 'lead.leadId', 'lead._id']),
    ].filter((v): v is string => !!v);
    for (const cand of idCandidates) {
      const { data } = await admin.from('prospects').select('*').eq('lgm_lead_id', cand).maybeSingle();
      if (data) { prospect = data; break; }
    }

    // 2) Matching par email
    if (!prospect) {
      const emails = [
        pick(payload, ['email']),
        pick(payload, ['persoEmail']),
        pick(payload, ['proEmail']),
        pick(payload, ['lead.email', 'lead.persoEmail', 'lead.proEmail']),
      ].filter((v): v is string => !!v);
      for (const em of emails) {
        const { data } = await admin.from('prospects').select('*').ilike('email', em).limit(1).maybeSingle();
        if (data) { prospect = data; break; }
      }
    }

    // 3) Matching par URL LinkedIn
    if (!prospect) {
      const linkedin = pick(payload, ['linkedin', 'linkedinUrl', 'linkedin_url', 'lead.linkedin', 'lead.linkedinUrl', 'lead.linkedin_url']);
      if (linkedin) {
        const { data } = await admin.from('prospects').select('*').eq('linkedin_url', linkedin).limit(1).maybeSingle();
        if (data) prospect = data;
      }
    }

    // 4) Matching par firstName + lastName + companyName
    if (!prospect) {
      const firstName = pick(payload, ['firstName', 'firstname', 'lead.firstName', 'lead.firstname']);
      const lastName = pick(payload, ['lastName', 'lastname', 'lead.lastName', 'lead.lastname']);
      const company = pick(payload, ['companyName', 'company', 'lead.companyName', 'lead.company']);
      if (firstName && lastName && company) {
        const fullName = `${firstName} ${lastName}`.trim();
        const { data } = await admin
          .from('prospects')
          .select('*')
          .ilike('contact_nom', fullName)
          .ilike('entreprise', company)
          .limit(1)
          .maybeSingle();
        if (data) prospect = data;
      }
    }


    if (!prospect) {
      // Tentative de création automatique d'un prospect à partir du payload LGM
      const firstName = pick(payload, ['firstName', 'firstname', 'lead.firstName', 'lead.firstname']);
      const lastName = pick(payload, ['lastName', 'lastname', 'lead.lastName', 'lead.lastname']);
      const company = pick(payload, ['companyName', 'company', 'lead.companyName', 'lead.company']);
      const location = pick(payload, ['location', 'city', 'lead.location', 'lead.city']);
      const emailNew = pick(payload, ['email', 'persoEmail', 'proEmail', 'lead.email', 'lead.persoEmail', 'lead.proEmail']);
      const linkedinNew = pick(payload, ['linkedin', 'linkedinUrl', 'linkedin_url', 'lead.linkedin', 'lead.linkedinUrl', 'lead.linkedin_url']);
      const audience = pick(payload, ['audience', 'audienceName', 'lead.audience', 'lead.audienceName']);

      const canCreate = !!(company || (firstName && lastName));

      if (canCreate) {
        // Dédoublonnage final avant insert (crmId + email)
        let dup: any = null;
        if (lgmLeadId) {
          const { data } = await admin.from('prospects').select('id').eq('lgm_lead_id', lgmLeadId).maybeSingle();
          if (data) dup = data;
        }
        if (!dup && emailNew) {
          const { data } = await admin.from('prospects').select('id').ilike('email', emailNew).limit(1).maybeSingle();
          if (data) dup = data;
        }

        if (dup) {
          if (logId) await admin.from('lgm_webhook_log').update({ action: 'dup_skip', matched_prospect: dup.id }).eq('id', logId);
          return new Response(JSON.stringify({ matched: false, created: false, prospect: dup.id, event, action: 'dup_skip' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Segment déduit de l'audience
        let segment: string | null = null;
        const an = norm(audience);
        if (an.includes('loisirs')) segment = 'loisirs';
        else if (an.includes('chr')) segment = 'chr';
        else if (an.includes('retail')) segment = 'retail';

        // Statut initial selon l'événement
        const mapped = mapEventToStatut(event);
        const initStatut = mapped ?? 'nouveau';

        const contactNom = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
        const entreprise = company || contactNom || 'Lead LinkedIn';

        const insertPayload: Record<string, unknown> = {
          entreprise,
          contact_nom: contactNom,
          ville: location,
          email: emailNew,
          linkedin_url: linkedinNew,
          source: 'linkedin',
          segment: segment ?? 'autre',
          statut: initStatut,
          lgm_lead_id: lgmLeadId,
          lgm_audience: audience,
          lgm_status: event || null,
        };

        const { data: created, error: insErr } = await admin
          .from('prospects')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insErr || !created) {
          if (logId) await admin.from('lgm_webhook_log').update({ action: `create_error:${insErr?.message ?? 'unknown'}` }).eq('id', logId);
          return new Response(JSON.stringify({ matched: false, created: false, event, error: insErr?.message }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        await admin.from('prospect_events').insert({
          prospect_id: created.id,
          type: 'lgm',
          contenu: 'Lead LinkedIn importé depuis LGM',
          nouveau_statut: initStatut,
        });

        if (logId) {
          await admin
            .from('lgm_webhook_log')
            .update({ matched_prospect: created.id, action: `created:${initStatut}` })
            .eq('id', logId);
        }

        return new Response(
          JSON.stringify({ matched: false, created: true, prospect: created.id, event, action: `created:${initStatut}` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (logId) await admin.from('lgm_webhook_log').update({ action: 'no_match' }).eq('id', logId);
      return new Response(JSON.stringify({ matched: false, created: false, event }), {
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
      JSON.stringify({ matched: true, created: false, prospect: prospect.id, event, action }),
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
