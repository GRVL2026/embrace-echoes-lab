import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-sonnet-5';

const SEG_LABEL: Record<string, string> = {
  loisirs: 'Loisirs (bowling / centre de loisirs)',
  chr: 'CHR / tourisme (bar, café, hôtel, camping)',
  retail: 'Retail / boutique pop-culture',
  revendeur: 'Revendeur',
  autre: 'Autre',
};

const CANAL_LABEL: Record<string, string> = {
  invitation: 'invitation LinkedIn',
  message: 'message LinkedIn',
  email: 'email',
};

const SYSTEM = `Tu es l'assistant commercial d'Avranches Automatic (marque Hypernova Arcade), distributeur français de bornes d'arcade, flippers, jeux d'adresse et distributeurs automatiques (blind-box, boosters TCG, figurines). Tu rédiges des accroches de prospection en français, en VOUVOIEMENT, pour des gérants/patrons de centres de loisirs & bowlings, de CHR & tourisme (bars, cafés, hôtels, campings) et de retail (boutiques pop-culture). Règles : court (2 à 4 phrases ; ~280 caractères max pour une invitation LinkedIn, ~500 pour un message ou un email) ; personnalisé au SIGNAL fourni ; ton chaleureux et professionnel, jamais lourd ni 'vendeur'. Mets en avant, quand c'est pertinent, les angles qui marchent : machines en DÉPÔT (sans investissement), PARTAGE DES RECETTES, rentabilisé en une saison, réassort géré, du CA sans surface en plus. Termine par une question ouverte / un CTA doux (un échange de 15 min, l'envoi de 2-3 configs). Zéro à un emoji maximum. N'invente AUCUN fait sur le prospect au-delà du signal fourni. Ne promets rien de faux.`;

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Auth
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return jsonErr(401, 'Unauthorized');
    const jwt = authHeader.slice(7);
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonErr(401, 'Unauthorized');

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const allowed = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    if (!allowed) return jsonErr(403, 'Forbidden');

    const body = await req.json().catch(() => ({}));
    const canal = String(body.canal || 'message');
    if (!['invitation', 'message', 'email'].includes(canal)) return jsonErr(400, 'canal invalide');

    let entreprise = body.entreprise ?? '';
    let contact_role = body.contact_role ?? '';
    let ville = body.ville ?? '';
    let segment = body.segment ?? 'autre';
    let signal = body.signal ?? '';

    if (body.prospect_id) {
      const { data: p, error: e } = await admin
        .from('prospects')
        .select('entreprise, contact_role, ville, segment, signal')
        .eq('id', body.prospect_id)
        .maybeSingle();
      if (e || !p) return jsonErr(404, 'Prospect introuvable');
      entreprise = p.entreprise ?? '';
      contact_role = p.contact_role ?? '';
      ville = p.ville ?? '';
      segment = p.segment ?? 'autre';
      signal = p.signal ?? '';
    }

    if (!entreprise) return jsonErr(400, 'entreprise manquante');

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonErr(500, "IA non configurée (ANTHROPIC_API_KEY manquant)");

    const segLbl = SEG_LABEL[segment] || segment;
    const canalLbl = CANAL_LABEL[canal];
    const maxTokens = canal === 'invitation' ? 220 : 400;

    const userPrompt = `Rédige une accroche de ${canalLbl} pour ce prospect.
Entreprise : ${entreprise}
Contact : ${contact_role || '—'}${ville ? ` à ${ville}` : ''}
Segment : ${segLbl}
Signal / contexte : ${signal || '(non renseigné, base-toi sur le segment)'}
Canal : ${canalLbl}.`;

    const resp = await anthropicJson(apiKey, {
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.8,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = (resp?.content ?? [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')
      .trim();

    if (!text) return jsonErr(502, "Réponse IA vide");

    return new Response(JSON.stringify({ accroche: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (isAnthropicOverload(err)) {
      return jsonErr(503, (err as any).userMessage);
    }
    console.error('[generer-accroche-prospect]', err);
    return jsonErr(500, err instanceof Error ? err.message : 'Erreur interne');
  }
});
