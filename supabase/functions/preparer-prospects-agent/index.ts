// Agent semi-auto de préparation prospection.
// - Entrées : signaux (source='signal', statut='nouveau', pret_a_envoyer=false, lgm_lead_id IS NULL).
// - Pour chacun : enrichissement via API gouv (gratuit) si besoin, génération d'une accroche IA (canal='message'),
//   passage à pret_a_envoyer=true.
// - Authentification : x-cron-secret == CRON_SECRET  OU  utilisateur admin/direction (JWT).
// - verify_jwt = false (voir supabase/config.toml).
// - try/catch par prospect : une erreur n'arrête pas le lot.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';
import { fetchCatalogSuggestions, renderSuggestionsForPrompt } from '../_shared/catalog-suggestions.ts';
import { gouvBySiren, gouvSearch, extractEnrichissement, pickUnambiguous, sleep, GOUV_RATE_LIMIT_MS } from '../_shared/gouv-entreprise.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const MODEL = 'claude-sonnet-5';
const BATCH_LIMIT = 20;

const SEG_LABEL: Record<string, string> = {
  loisirs: 'Loisirs (bowling / centre de loisirs)',
  chr: 'CHR / tourisme (bar, café, hôtel, camping)',
  retail: 'Retail / boutique pop-culture',
  revendeur: 'Revendeur',
  autre: 'Autre',
};

const SYSTEM_ACCROCHE = `Tu es l'assistant commercial d'Avranches Automatic, distributeur français de bornes d'arcade, flippers, jeux d'adresse et distributeurs automatiques (blind-box, boosters TCG, figurines). Tu rédiges des accroches de prospection en français, en VOUVOIEMENT, pour des gérants/patrons de centres de loisirs & bowlings, de CHR & tourisme (bars, cafés, hôtels, campings) et de retail (boutiques pop-culture). Règles : court (2 à 4 phrases ; ~500 caractères max pour un message ou un email) ; personnalisé au SIGNAL fourni ; ton chaleureux et professionnel, jamais lourd ni 'vendeur'. Mets en avant, quand c'est pertinent, les angles qui marchent : machines en DÉPÔT (sans investissement), PARTAGE DES RECETTES, rentabilisé en une saison, réassort géré, du CA sans surface en plus. Termine par une question ouverte / un CTA doux (un échange de 15 min, l'envoi de 2-3 configs). Zéro à un emoji maximum. N'invente AUCUN fait sur le prospect au-delà du signal fourni. Ne promets rien de faux.`;

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enrichir(admin: any, p: any): Promise<Record<string, unknown>> {
  // API gouv gratuite : aucun crédit Pappers consommé.
  if (p.siren && p.contact_nom && p.siret) return {};

  let siren: string | null = p.siren ? String(p.siren).replace(/\D/g, '').slice(0, 9) : null;
  let hit: any = null;

  if (siren) {
    hit = await gouvBySiren(siren);
    if (!hit) throw new Error(`Aucune entreprise trouvée pour le SIREN ${siren} (API gouv)`);
  } else {
    if (!p.entreprise) return {};
    const q = [p.entreprise, p.ville].filter(Boolean).join(' ');
    const results = await gouvSearch(q, 5);
    if (results === null) throw new Error('API recherche-entreprises injoignable');
    if (results.length === 0) throw new Error(`Aucune correspondance pour "${q}"`);
    const res = pickUnambiguous(results, p.entreprise);
    if (res.ambiguous) {
      throw new Error(`Enrichissement impossible : plusieurs correspondances (${res.candidats}) pour "${q}"`);
    }
    hit = res.hit;
    siren = String(hit?.siren ?? '').replace(/\D/g, '').slice(0, 9) || null;
  }
  if (!hit || !siren) return {};

  const enriched = { siren, ...extractEnrichissement(hit) } as Record<string, any>;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(enriched)) {
    const nv = enriched[k];
    if (nv === null || nv === undefined || nv === '') continue;
    const cur = p[k];
    if (cur === null || cur === undefined || cur === '') patch[k] = nv;
  }
  if (!p.siren && enriched.siren) patch.siren = enriched.siren;
  if (enriched.etat_administratif) patch.etat_administratif = enriched.etat_administratif;
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('prospects').update(patch).eq('id', p.id);
    if (error) throw new Error(`Update prospect: ${error.message}`);
    Object.assign(p, patch);
  }
  await sleep(GOUV_RATE_LIMIT_MS);
  return patch;
}



async function genererAccroche(admin: any, p: any): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquant');
  const segLbl = SEG_LABEL[p.segment ?? 'autre'] || String(p.segment ?? 'autre');
  const suggestions = await fetchCatalogSuggestions(admin, p.segment, 4);
  const suggestionsBlock = renderSuggestionsForPrompt(suggestions);
  const userPrompt = `Rédige une accroche de message LinkedIn pour ce prospect.
Entreprise : ${p.entreprise}
Contact : ${p.contact_role || '—'}${p.ville ? ` à ${p.ville}` : ''}
Segment : ${segLbl}
Signal / contexte : ${p.signal || '(non renseigné, base-toi sur le segment)'}
Canal : message LinkedIn.${suggestionsBlock ? `

Machines RÉELLES de notre catalogue adaptées à ce type d'établissement :
${suggestionsBlock}

Cite 2-3 de ces machines (par leur nom EXACT tel qu'écrit ci-dessus), les plus adaptées à ce type d'établissement. Reste concret et crédible. Ne cite AUCUNE machine hors de cette liste.` : ''}`;
  const resp = await anthropicJson(ANTHROPIC_API_KEY, {
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_ACCROCHE,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = (resp?.content ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Réponse IA vide');
  return text;
}

async function checkAuth(req: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const cronHeader = req.headers.get('x-cron-secret') || '';
  if (CRON_SECRET && cronHeader && cronHeader === CRON_SECRET) return { ok: true };

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return { ok: false, response: jsonRes(401, { error: 'Unauthorized' }) };
  const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: u, error: e } = await sb.auth.getUser(jwt);
  if (e || !u?.user) return { ok: false, response: jsonRes(401, { error: 'Unauthorized' }) };
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // Permission restreinte (défaut OFF, accordée compte par compte).
  const { data: perm } = await admin
    .from('user_menu_access')
    .select('allowed')
    .eq('user_id', u.user.id)
    .eq('section_key', 'prospection.preparer')
    .maybeSingle();
  if (perm?.allowed !== true) {
    return { ok: false, response: jsonRes(403, { error: 'Action réservée (permission manquante : prospection.preparer)' }) };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authRes = await checkAuth(req);
    if (!('ok' in authRes) || !authRes.ok) return (authRes as any).response;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: rows, error } = await admin
      .from('prospects')
      .select('*')
      .eq('source', 'signal')
      .eq('statut', 'nouveau')
      .eq('pret_a_envoyer', false)
      .is('lgm_lead_id', null)
      .order('created_at', { ascending: false })
      .limit(BATCH_LIMIT);
    if (error) return jsonRes(500, { error: error.message });

    const list = (rows ?? []) as any[];
    const exemples: any[] = [];
    let prepared = 0;
    const errors: { id: string; entreprise: string; error: string }[] = [];

    for (const p of list) {
      try {
        // 1) Enrichissement si SIRET manquant
        if (!p.siret) {
          try {
            await enrichir(admin, p);
          } catch (e) {
            // On continue même si l'API gouv échoue (indisponible, non trouvé, ambiguïté…)
            errors.push({ id: p.id, entreprise: p.entreprise, error: `Enrichissement: ${(e as Error).message}` });
          }
        }

        // 2) Accroche IA
        const accroche = await genererAccroche(admin, p);

        // 3) Journal + flag prêt
        const now = new Date().toISOString();
        const { error: upErr } = await admin
          .from('prospects')
          .update({
            accroche_defaut: accroche,
            pret_a_envoyer: true,
            prepare_at: now,
          })
          .eq('id', p.id);
        if (upErr) throw new Error(`Update: ${upErr.message}`);

        await admin.from('prospect_events').insert([
          { prospect_id: p.id, type: 'message', contenu: accroche },
          { prospect_id: p.id, type: 'preparation', contenu: 'Prospect préparé automatiquement (agent)' },
        ]);

        prepared++;
        if (exemples.length < 3) exemples.push({ id: p.id, entreprise: p.entreprise, accroche });
      } catch (e) {
        if (isAnthropicOverload(e)) {
          errors.push({ id: p.id, entreprise: p.entreprise, error: (e as any).userMessage });
        } else {
          errors.push({ id: p.id, entreprise: p.entreprise, error: (e as Error).message ?? 'erreur' });
        }
        continue;
      }
    }

    return jsonRes(200, {
      ok: true,
      candidats: list.length,
      prepared,
      exemples,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    return jsonRes(500, { error: (e as Error).message ?? 'Erreur inconnue' });
  }
});
