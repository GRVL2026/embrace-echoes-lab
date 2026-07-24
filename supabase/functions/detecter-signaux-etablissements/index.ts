import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

type Segment = 'loisirs' | 'chr' | 'retail';

// Ordre = priorité (loisirs > chr > retail)
const NAF_MAP: { code: string; segment: Segment; libelle: string }[] = [
  { code: '93.29Z', segment: 'loisirs', libelle: 'autres activités récréatives et de loisirs' },
  { code: '93.21Z', segment: 'loisirs', libelle: "parcs d'attractions et parcs à thèmes" },
  { code: '56.30Z', segment: 'chr',     libelle: 'débits de boissons' },
  { code: '55.30Z', segment: 'chr',     libelle: 'terrains de camping et parcs pour caravanes' },
  { code: '55.10Z', segment: 'chr',     libelle: 'hôtels et hébergement similaire' },
  { code: '47.65Z', segment: 'retail',  libelle: 'commerce de détail de jeux et jouets' },
];

const MAX_INSERT = 40;
const PAGES_PER_NAF = 12; // 12 * 25 = 300 examinés max par NAF
const API = 'https://recherche-entreprises.api.gouv.fr/search';

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithRetry(url: string, tries = 2): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(to);
      if (r.status === 429 || r.status >= 500) {
        await new Promise((res) => setTimeout(res, 800));
        continue;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return null;
}

async function isAuthorized(req: Request): Promise<boolean> {
  // Service role via CRON_SECRET (tâche planifiée)
  const cron = req.headers.get('x-cron-secret');
  if (CRON_SECRET && cron === CRON_SECRET) return true;

  // Utilisateur authentifié admin/direction
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims) return false;
  const uid = data.claims.sub as string;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
  return (roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!(await isAuthorized(req))) return j(401, { error: 'Unauthorized' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fenêtre 30 jours
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Set des SIREN déjà connus
    const { data: existing } = await admin
      .from('prospects')
      .select('siren, entreprise, ville')
      .not('siren', 'is', null);
    const knownSiren = new Set<string>();
    const knownPair = new Set<string>();
    for (const r of (existing || []) as any[]) {
      if (r.siren) knownSiren.add(String(r.siren).trim());
      if (r.entreprise && r.ville) knownPair.add(`${String(r.entreprise).toLowerCase().trim()}|${String(r.ville).toLowerCase().trim()}`);
    }

    const toInsert: any[] = [];
    const examples: string[] = [];
    let scanned = 0;
    let apiSupportsDateFilter = false; // détecté à l'exécution

    outer:
    for (const naf of NAF_MAP) {
      for (let page = 1; page <= PAGES_PER_NAF; page++) {
        if (toInsert.length >= MAX_INSERT) break outer;

        const url = `${API}?activite_principale=${encodeURIComponent(naf.code)}&etat_administratif=A&per_page=25&page=${page}&minimal=true&include=siege`;
        const data = await fetchWithRetry(url);
        if (!data || !Array.isArray(data.results) || data.results.length === 0) break;

        for (const r of data.results) {
          scanned++;
          const siege = r.siege || {};
          const dateCrea: string | null = siege.date_creation || r.date_creation || null;
          if (!dateCrea) continue;
          if (dateCrea < cutoffStr) continue; // > 30 jours

          apiSupportsDateFilter = false; // (filtrage est manuel, restera false)

          const siren = String(r.siren || '').trim();
          if (!siren || knownSiren.has(siren)) continue;

          const nom = (r.nom_complet || r.nom_raison_sociale || '').trim();
          const ville = (siege.libelle_commune || '').trim();
          if (!nom) continue;

          const pairKey = `${nom.toLowerCase()}|${ville.toLowerCase()}`;
          if (knownPair.has(pairKey)) continue;

          const signal =
            `Nouvel établissement — ${naf.libelle} (${naf.code}) créé le ${dateCrea}` +
            (ville ? ` à ${ville}` : '');

          toInsert.push({
            entreprise: nom,
            ville: ville || null,
            siren,
            segment: naf.segment,
            source: 'signal',
            statut: 'nouveau',
            signal,
          });
          knownSiren.add(siren);
          knownPair.add(pairKey);
          if (examples.length < 5) examples.push(nom);

          if (toInsert.length >= MAX_INSERT) break outer;
        }
        // Petit throttle
        await new Promise((res) => setTimeout(res, 120));
      }
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const { data: ins, error: insErr } = await admin
        .from('prospects')
        .insert(toInsert)
        .select('id');
      if (insErr) {
        return j(500, { error: `insert failed: ${insErr.message}`, scanned });
      }
      inserted = ins?.length ?? 0;
    }

    return j(200, {
      inserted,
      scanned,
      exemples: examples,
      note: apiSupportsDateFilter
        ? undefined
        : "L'API recherche-entreprises.api.gouv.fr ne propose pas de filtre serveur par date de création : le filtrage 30 jours est appliqué côté fonction sur les résultats paginés (priorité loisirs > CHR > retail).",
    });
  } catch (e) {
    return j(500, { error: (e as Error).message });
  }
});
