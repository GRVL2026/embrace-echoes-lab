import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LGM_API_KEY = Deno.env.get('LGM_API_KEY') ?? '';
const LGM_BASE = 'https://apiv2.lagrowthmachine.com/flow';

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

function normalizeName(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function splitContactName(full: string | null | undefined): { firstname: string; lastname: string } {
  const s = (full ?? '').trim();
  if (!s) return { firstname: '', lastname: '' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0], lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

async function lgmFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${LGM_BASE}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-API-KEY': LGM_API_KEY,
      'Authorization': `Bearer ${LGM_API_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
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

    // ---- 1. Résoudre audience par nom ----
    const audRes = await lgmFetch('/audiences', { method: 'GET' });
    if (!audRes.ok) {
      return jsonRes(502, {
        error: `LGM: impossible de lister les audiences (${audRes.status})`,
        details: audRes.body,
      });
    }
    const list: any[] = Array.isArray(audRes.body)
      ? audRes.body
      : (audRes.body?.audiences ?? audRes.body?.data ?? []);
    const target = list.find((a: any) => normalizeName(String(a?.name ?? '')) === normalizeName(audienceName));
    if (!target) {
      return jsonRes(400, { error: `Crée l'audience '${audienceName}' dans LGM` });
    }
    const audienceId = target.id ?? target._id ?? target.audienceId;
    if (!audienceId) {
      return jsonRes(502, { error: 'LGM: audience trouvée mais id manquant', details: target });
    }

    // ---- 2. Dernière accroche IA ----
    const { data: evs } = await admin
      .from('prospect_events')
      .select('contenu, created_at')
      .eq('prospect_id', prospect_id)
      .eq('type', 'message')
      .order('created_at', { ascending: false })
      .limit(1);
    const accroche = evs?.[0]?.contenu ?? null;

    // ---- 3. Construire l'identity ----
    const { firstname, lastname } = splitContactName(p.contact_nom);
    const customAttributes: { name: string; value: string }[] = [];
    if (accroche && accroche.trim()) customAttributes.push({ name: 'accroche', value: accroche.trim() });
    if (p.ville) customAttributes.push({ name: 'ville', value: String(p.ville) });
    if (p.signal) customAttributes.push({ name: 'signal', value: String(p.signal) });

    const identity: Record<string, unknown> = {
      audienceId,
      firstname: firstname || (p.entreprise ?? ''),
      lastname: lastname || '',
      companyName: p.entreprise ?? '',
    };
    if (p.linkedin_url) identity.linkedinUrl = p.linkedin_url;
    if (p.email) { identity.proEmail = p.email; identity.email = p.email; }
    if (p.telephone) identity.phone = p.telephone;
    if (customAttributes.length) identity.customAttributes = customAttributes;

    // ---- 4. Créer/MAJ lead LGM ----
    // Endpoint standard LGM v2 : POST /flow/identities avec audienceId dans le corps.
    const createRes = await lgmFetch('/identities', {
      method: 'POST',
      body: JSON.stringify(identity),
    });
    if (!createRes.ok) {
      return jsonRes(502, {
        error: `LGM: création du lead impossible (${createRes.status})`,
        details: createRes.body,
      });
    }
    const created: any = createRes.body ?? {};
    const lgm_lead_id = String(
      created?.id ?? created?._id ?? created?.identityId ?? created?.leadId ?? '',
    );

    // ---- 5. Mise à jour prospect + journal ----
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
