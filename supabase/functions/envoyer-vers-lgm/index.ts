import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LGM_API_KEY = Deno.env.get('LGM_API_KEY') ?? '';
const LGM_LEADS_URL = 'https://apiv2.lagrowthmachine.com/flow/leads';

type Segment = 'loisirs' | 'chr' | 'retail' | 'revendeur' | 'autre';

const AUDIENCE_NAME_BY_SEGMENT: Partial<Record<Segment, string>> = {
  loisirs: 'Arcade OS – Loisirs',
  chr: 'Arcade OS – CHR',
  retail: 'Arcade OS – Retail',
};

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function splitContactName(full: string | null | undefined): { firstname: string; lastname: string } {
  const s = (full ?? '').trim();
  if (!s) return { firstname: '', lastname: '' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0], lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ---- Auth : admin / direction only ----
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return jsonRes(401, { error: 'Unauthorized' });

    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonRes(401, { error: 'Unauthorized' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const allowed = (roles || []).some((r: any) => ['admin', 'direction'].includes(r.role));
    if (!allowed) return jsonRes(403, { error: 'Forbidden' });

    if (!LGM_API_KEY) return jsonRes(500, { error: 'LGM_API_KEY manquant côté serveur' });

    // ---- Input ----
    const body = await req.json().catch(() => ({}));
    const prospect_id = String(body?.prospect_id ?? '').trim();
    if (!prospect_id) return jsonRes(400, { error: 'prospect_id requis' });

    const { data: p, error: pErr } = await admin
      .from('prospects')
      .select('*')
      .eq('id', prospect_id)
      .maybeSingle();
    if (pErr || !p) return jsonRes(404, { error: 'Prospect introuvable' });

    const segment = (p.segment ?? 'autre') as Segment;
    const audienceName = AUDIENCE_NAME_BY_SEGMENT[segment];
    if (!audienceName) {
      return jsonRes(400, {
        error: `Segment '${segment}' non supporté. Segments LGM : loisirs, chr, retail.`,
      });
    }

    // ---- Dernière accroche IA ----
    const { data: evs } = await admin
      .from('prospect_events')
      .select('contenu, created_at')
      .eq('prospect_id', prospect_id)
      .eq('type', 'message')
      .order('created_at', { ascending: false })
      .limit(1);
    const accroche = evs?.[0]?.contenu ?? null;

    // ---- Construire le payload LGM ----
    const { firstname, lastname } = splitContactName(p.contact_nom);
    const payload: Record<string, unknown> = {
      audience: audienceName,
      firstname: firstname || (p.entreprise ?? ''),
      lastname: lastname || '',
      companyName: p.entreprise ?? '',
    };
    if (p.linkedin_url) payload.linkedinUrl = p.linkedin_url;
    if (p.email) payload.proEmail = p.email;
    // LGM — attributs personnalisés : slots scalaires à la racine du payload
    // (customAttribute1..customAttribute10) sur POST /flow/leads?apikey=...
    // Slot #1 est labellisé "accroche" côté LGM => variable {{accroche}}
    // dans les séquences. Doc LGM v2 : champ string, pas d'objet ni d'array.
    if (accroche && accroche.trim()) payload.customAttribute1 = accroche.trim();

    // ---- Appel LGM : POST /flow/leads?apikey=... ----
    const url = `${LGM_LEADS_URL}?apikey=${encodeURIComponent(LGM_API_KEY)}`;
    const lgmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await lgmRes.text();
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { raw }; }

    if (!lgmRes.ok) {
      return jsonRes(502, {
        error: `LGM ${lgmRes.status}`,
        lgm_message: parsed?.message ?? parsed?.error ?? parsed?.raw ?? parsed,
        details: parsed,
      });
    }

    const lgm_lead_id = String(
      parsed?.id ?? parsed?._id ?? parsed?.leadId ?? parsed?.identityId ?? '',
    );

    // ---- Mise à jour prospect + journal ----
    await admin
      .from('prospects')
      .update({
        lgm_lead_id: lgm_lead_id || null,
        lgm_audience: audienceName,
        lgm_sent_at: new Date().toISOString(),
      })
      .eq('id', prospect_id);

    await admin.from('prospect_events').insert({
      prospect_id,
      type: 'lgm',
      contenu: `Envoyé vers LGM – ${audienceName}`,
      auteur: userData.user.id,
    });

    return jsonRes(200, { ok: true, lgm_lead_id, audience: audienceName });
  } catch (e) {
    return jsonRes(500, { error: (e as Error).message ?? 'Erreur inconnue' });
  }
});
