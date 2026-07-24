// Enrichissement d'un prospect via l'API Pappers (v2).
// - Endpoint principal : GET https://api.pappers.fr/v2/entreprise?siren=... (si siren connu)
// - Fallback : GET https://api.pappers.fr/v2/recherche?q=...&code_postal/ville (nom + ville)
// - Puis GET https://api.pappers.fr/v2/entreprise?siren=<hit.siren> pour détail complet.
// Auth : admin / direction (JWT). Secret PAPPERS_API_KEY (jamais loggé).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY') ?? '';

const PAPPERS_ENTREPRISE = 'https://api.pappers.fr/v2/entreprise';
const PAPPERS_RECHERCHE = 'https://api.pappers.fr/v2/recherche';

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function pick<T>(...vals: (T | null | undefined | '')[]): T | null {
  for (const v of vals) if (v !== null && v !== undefined && v !== '') return v as T;
  return null;
}

function joinAddr(parts: (string | null | undefined)[]): string | null {
  const s = parts.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join(', ');
  return s || null;
}

function extractDirigeantPP(det: any): { nom: string | null; role: string | null } {
  const dl = Array.isArray(det?.representants) ? det.representants
    : Array.isArray(det?.dirigeants) ? det.dirigeants
    : [];
  // priorité : personne physique
  const pp = dl.find((d: any) => {
    const t = String(d?.type_dirigeant ?? d?.type ?? '').toLowerCase();
    return t.includes('physique') || (d?.nom && d?.prenom);
  }) ?? dl[0];
  if (!pp) return { nom: null, role: null };
  const prenom = pp.prenom ?? pp.prenoms ?? '';
  const nom = pp.nom ?? pp.nom_complet ?? '';
  const full = [prenom, nom].filter(Boolean).join(' ').trim() || null;
  const role = pp.qualite ?? pp.fonction ?? pp.role ?? null;
  return { nom: full, role };
}

function extractCA(det: any): number | null {
  // Pappers renvoie généralement finances[] avec { annee, chiffre_affaires, ... }
  const fin = Array.isArray(det?.finances) ? det.finances : [];
  if (fin.length) {
    const sorted = [...fin].sort((a: any, b: any) => Number(b.annee ?? 0) - Number(a.annee ?? 0));
    const ca = sorted.find((f: any) => f?.chiffre_affaires != null)?.chiffre_affaires;
    if (ca != null) return Number(ca);
  }
  if (det?.chiffre_affaires != null) return Number(det.chiffre_affaires);
  return null;
}

function extractAdresse(det: any): string | null {
  const s = det?.siege ?? {};
  return pick<string>(
    s.adresse_ligne_complete,
    s.adresse_complete,
    joinAddr([s.adresse_ligne_1, s.code_postal, s.ville]),
    joinAddr([det?.adresse_ligne_1, det?.code_postal, det?.ville]),
  );
}

function extractTelephone(det: any): string | null {
  const t = pick<string>(det?.telephone, det?.siege?.telephone);
  if (t) return String(t);
  const arr = det?.telephones ?? det?.siege?.telephones;
  if (Array.isArray(arr) && arr.length) return String(arr[0]);
  return null;
}

function extractSite(det: any): string | null {
  const s = pick<string>(det?.site_web, det?.site_internet, det?.siege?.site_web);
  if (s) return String(s);
  const arr = det?.sites_internet ?? det?.siege?.sites_internet;
  if (Array.isArray(arr) && arr.length) return String(arr[0]);
  return null;
}

function extractActivite(det: any): string | null {
  return pick<string>(
    det?.libelle_code_naf,
    det?.libelle_activite_principale,
    det?.libelle_activite,
    det?.activite_principale?.libelle,
  );
}

function extractSiretSiege(det: any): string | null {
  return pick<string>(det?.siege?.siret, det?.siret_siege, det?.siret);
}

function extractEffectif(det: any): string | null {
  return pick<string>(
    det?.tranche_effectif,
    det?.libelle_tranche_effectif,
    det?.effectif,
  );
}

async function pappersEntrepriseBySiren(siren: string): Promise<any | null> {
  const url = `${PAPPERS_ENTREPRISE}?api_token=${encodeURIComponent(PAPPERS_API_KEY)}&siren=${encodeURIComponent(siren)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const raw = await r.text().catch(() => '');
    let parsed: any = null; try { parsed = JSON.parse(raw); } catch { /* noop */ }
    throw new Error(parsed?.message ?? parsed?.error ?? `Pappers ${r.status}`);
  }
  return await r.json();
}

async function pappersRecherche(name: string, ville: string | null): Promise<string | null> {
  const params = new URLSearchParams({ api_token: PAPPERS_API_KEY, q: name, precision: 'standard', per_page: '5' });
  if (ville) params.set('ville', ville);
  const url = `${PAPPERS_RECHERCHE}?${params.toString()}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const raw = await r.text().catch(() => '');
    let parsed: any = null; try { parsed = JSON.parse(raw); } catch { /* noop */ }
    throw new Error(parsed?.message ?? parsed?.error ?? `Pappers ${r.status}`);
  }
  const json = await r.json();
  const results = json?.resultats ?? json?.results ?? [];
  const hit = results?.[0];
  return hit?.siren ? String(hit.siren) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Auth admin/direction
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

    if (!PAPPERS_API_KEY) return jsonRes(500, { error: 'PAPPERS_API_KEY manquant côté serveur' });

    const body = await req.json().catch(() => ({}));
    const prospect_id = String(body?.prospect_id ?? '').trim();
    if (!prospect_id) return jsonRes(400, { error: 'prospect_id requis' });

    const { data: p, error: pErr } = await admin.from('prospects').select('*').eq('id', prospect_id).maybeSingle();
    if (pErr || !p) return jsonRes(404, { error: 'Prospect introuvable' });

    // Résolution SIREN
    let siren: string | null = p.siren ? String(p.siren).replace(/\D/g, '').slice(0, 9) : null;
    if (!siren) {
      if (!p.entreprise) return jsonRes(400, { error: 'Aucun SIREN ni nom d’entreprise sur ce prospect' });
      try {
        siren = await pappersRecherche(p.entreprise, p.ville ?? null);
      } catch (e) {
        return jsonRes(502, { error: `Recherche Pappers: ${(e as Error).message}` });
      }
      if (!siren) return jsonRes(404, { error: `Aucune entreprise trouvée sur Pappers pour "${p.entreprise}"` });
    }

    // Détail entreprise
    let det: any;
    try {
      det = await pappersEntrepriseBySiren(siren);
    } catch (e) {
      return jsonRes(502, { error: `Pappers: ${(e as Error).message}` });
    }
    if (!det) return jsonRes(404, { error: 'Détail entreprise introuvable' });

    // Extraction
    const dir = extractDirigeantPP(det);
    const enriched = {
      siren,
      siret: extractSiretSiege(det),
      adresse: extractAdresse(det),
      effectif: extractEffectif(det),
      ca_annuel: extractCA(det),
      activite: extractActivite(det),
      telephone: extractTelephone(det),
      site_web: extractSite(det),
      contact_nom: dir.nom,
      contact_role: dir.role,
    };

    // Ne pas écraser un champ déjà rempli côté prospect par une valeur vide.
    // Compléter surtout les champs vides.
    const patch: Record<string, unknown> = {};
    const setIfEmpty = (key: keyof typeof enriched) => {
      const cur = (p as any)[key];
      const nv = enriched[key];
      if (nv === null || nv === undefined || nv === '') return;
      if (cur === null || cur === undefined || cur === '') patch[key] = nv;
    };
    // Champs enrichis : compléter si vide (préserver la saisie utilisateur)
    (Object.keys(enriched) as Array<keyof typeof enriched>).forEach(setIfEmpty);
    // siren : si absent, poser ; si présent et différent (nettoyé), on garde l'ancien (audit).
    if (!p.siren && enriched.siren) patch.siren = enriched.siren;

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await admin.from('prospects').update(patch).eq('id', prospect_id);
      if (upErr) return jsonRes(500, { error: `Mise à jour prospect: ${upErr.message}` });
    }

    await admin.from('prospect_events').insert({
      prospect_id,
      type: 'enrichissement',
      contenu: 'Fiche enrichie via Pappers',
      auteur: userData.user.id,
    });

    return jsonRes(200, { ok: true, enriched, applied: patch });
  } catch (e) {
    return jsonRes(500, { error: (e as Error).message ?? 'Erreur inconnue' });
  }
});
