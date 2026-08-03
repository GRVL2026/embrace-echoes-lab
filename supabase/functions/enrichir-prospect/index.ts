// Enrichissement d'un prospect via l'API publique recherche-entreprises.api.gouv.fr
// (gratuite, sans clé). Ne consomme plus AUCUN crédit Pappers.
// Auth : admin / direction (JWT).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { gouvBySiren, gouvSearch, extractEnrichissement } from '../_shared/gouv-entreprise.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return jsonRes(401, { error: 'Unauthorized' });

    const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonRes(401, { error: 'Unauthorized' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const allowed = (roles || []).some((r: any) => ['admin', 'direction'].includes(r.role));
    if (!allowed) return jsonRes(403, { error: 'Forbidden' });

    const body = await req.json().catch(() => ({}));
    const prospect_id = String(body?.prospect_id ?? '').trim();
    if (!prospect_id) return jsonRes(400, { error: 'prospect_id requis' });

    const { data: p, error: pErr } = await admin.from('prospects').select('*').eq('id', prospect_id).maybeSingle();
    if (pErr || !p) return jsonRes(404, { error: 'Prospect introuvable' });

    // Résolution du hit : siren si connu, sinon "<nom> <ville>"
    let hit: any = null;
    const cleanSiren = p.siren ? String(p.siren).replace(/\D/g, '').slice(0, 9) : null;
    if (cleanSiren) {
      hit = await gouvBySiren(cleanSiren);
    } else {
      if (!p.entreprise) return jsonRes(400, { error: 'Aucun SIREN ni nom d’entreprise sur ce prospect' });
      const q = [p.entreprise, p.ville].filter(Boolean).join(' ');
      const results = await gouvSearch(q, 5);
      if (results === null) return jsonRes(502, { error: 'API recherche-entreprises indisponible' });
      hit = results[0] ?? null;
    }
    if (!hit) return jsonRes(404, { error: `Aucune entreprise trouvée pour "${p.entreprise ?? cleanSiren}"` });

    const enriched = {
      siren: cleanSiren ?? (String(hit.siren ?? '').replace(/\D/g, '').slice(0, 9) || null),
      ...extractEnrichissement(hit),
    };

    // Complète uniquement les champs vides du prospect
    const patch: Record<string, unknown> = {};
    const setIfEmpty = (key: keyof typeof enriched) => {
      const cur = (p as any)[key];
      const nv = enriched[key];
      if (nv === null || nv === undefined || nv === '') return;
      if (cur === null || cur === undefined || cur === '') patch[key] = nv;
    };
    (Object.keys(enriched) as Array<keyof typeof enriched>).forEach(setIfEmpty);
    if (!p.siren && enriched.siren) patch.siren = enriched.siren;

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await admin.from('prospects').update(patch).eq('id', prospect_id);
      if (upErr) return jsonRes(500, { error: `Mise à jour prospect: ${upErr.message}` });
    }

    await admin.from('prospect_events').insert({
      prospect_id,
      type: 'enrichissement',
      contenu: 'Fiche enrichie via API recherche-entreprises (gouv)',
      auteur: userData.user.id,
    });

    return jsonRes(200, { ok: true, enriched, applied: patch });
  } catch (e) {
    return jsonRes(500, { error: (e as Error).message ?? 'Erreur inconnue' });
  }
});
