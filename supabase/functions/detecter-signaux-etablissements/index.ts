import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY') || '';

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
const PER_PAGE = 20;
const MAX_PAGES_PER_NAF = 3; // économie de crédits Pappers
const API = 'https://api.pappers.fr/v2/recherche';

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
      const to = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(to);
      if (r.status === 429 || r.status >= 500) {
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await new Promise((res) => setTimeout(res, 600));
    }
  }
  return null;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const cron = req.headers.get('x-cron-secret');
  if (CRON_SECRET && cron === CRON_SECRET) return true;

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

function extractDirigeant(entreprise: any): { nom: string | null; role: string | null } {
  // Chemins Pappers possibles selon l'endpoint : entreprise.representants[], entreprise.dirigeants[]
  const dirs: any[] =
    entreprise?.representants ||
    entreprise?.dirigeants ||
    entreprise?.entreprise?.representants ||
    entreprise?.entreprise?.dirigeants ||
    [];
  if (!Array.isArray(dirs) || dirs.length === 0) return { nom: null, role: null };

  // Priorité : première personne physique
  const isPP = (d: any) =>
    (d?.personne_morale === false) ||
    (typeof d?.type === 'string' && d.type.toLowerCase().includes('physique')) ||
    (!!d?.prenom || !!d?.prenoms) ||
    (!d?.siren && !d?.denomination);

  const d = dirs.find(isPP) || dirs[0];
  if (!d) return { nom: null, role: null };

  const prenom = (d.prenom || (Array.isArray(d.prenoms) ? d.prenoms[0] : d.prenoms) || '')
    .toString().trim();
  const nomFam = (d.nom || d.nom_usage || '').toString().trim();
  let nom = [prenom, nomFam].filter(Boolean).join(' ').trim();
  if (!nom) nom = (d.nom_complet || d.denomination || '').toString().trim();
  const role = (d.qualite || d.fonction || d.role || '').toString().trim() || null;
  return { nom: nom || null, role };
}

async function fetchDirigeant(siren: string): Promise<{ nom: string | null; role: string | null }> {
  // /v2/entreprise renvoie systématiquement le bloc representants (personnes physiques + morales)
  const params = new URLSearchParams({ api_token: PAPPERS_API_KEY, siren });
  const data = await fetchWithRetry(`https://api.pappers.fr/v2/entreprise?${params.toString()}`);
  if (!data) return { nom: null, role: null };
  return extractDirigeant(data);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!(await isAuthorized(req))) return j(401, { error: 'Unauthorized' });
    if (!PAPPERS_API_KEY) return j(500, { error: 'PAPPERS_API_KEY manquant' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fenêtre 30 jours
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Prospects déjà connus
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

    outer:
    for (const naf of NAF_MAP) {
      for (let page = 1; page <= MAX_PAGES_PER_NAF; page++) {
        if (toInsert.length >= MAX_INSERT) break outer;

        // Paramètres Pappers /v2/recherche : code_naf, date_creation_min (YYYY-MM-DD), entreprise_cessee=false
        const params = new URLSearchParams({
          api_token: PAPPERS_API_KEY,
          code_naf: naf.code,
          date_creation_min: cutoffStr,
          entreprise_cessee: 'false',
          precision: 'standard',
          par_page: String(PER_PAGE),
          page: String(page),
        });
        const url = `${API}?${params.toString()}`;
        const data = await fetchWithRetry(url);
        if (!data) break;
        const results: any[] = Array.isArray(data.resultats) ? data.resultats : [];
        if (results.length === 0) break;

        for (const r of results) {
          scanned++;
          const dateCrea: string | null = r.date_creation || r.date_creation_formatee || null;
          if (!dateCrea) continue;
          if (dateCrea < cutoffStr) continue; // sécurité côté fonction

          const siren = String(r.siren || '').trim();
          if (!siren || knownSiren.has(siren)) continue;

          const nom = (r.nom_entreprise || r.denomination || r.nom_complet || '').toString().trim();
          const siege = r.siege || {};
          const ville = (siege.ville || r.ville || '').toString().trim();
          if (!nom) continue;

          const pairKey = `${nom.toLowerCase()}|${ville.toLowerCase()}`;
          if (knownPair.has(pairKey)) continue;

          const dirig = extractDirigeant(r);
          let finalDirig = dirig;
          if (!dirig.nom) {
            finalDirig = await fetchDirigeant(siren);
            await new Promise((res) => setTimeout(res, 120));
          }

          const signal =
            `Nouvel établissement — ${naf.libelle} (${naf.code}) créé le ${dateCrea}` +
            (ville ? ` à ${ville}` : '');

          const row: Record<string, any> = {
            entreprise: nom,
            ville: ville || null,
            siren,
            segment: naf.segment,
            source: 'signal',
            statut: 'nouveau',
            signal,
          };
          if (finalDirig.nom) row.contact_nom = finalDirig.nom;
          if (finalDirig.role) row.contact_role = finalDirig.role;

          toInsert.push(row);
          knownSiren.add(siren);
          knownPair.add(pairKey);
          if (examples.length < 5) examples.push(nom);

          if (toInsert.length >= MAX_INSERT) break outer;
        }
        await new Promise((res) => setTimeout(res, 150));
      }
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      // Tentative avec contact_nom/contact_role ; fallback si colonnes absentes
      let { data: ins, error: insErr } = await admin
        .from('prospects')
        .insert(toInsert)
        .select('id');
      if (insErr && /contact_(nom|role)/i.test(insErr.message)) {
        const stripped = toInsert.map(({ contact_nom, contact_role, ...rest }) => rest);
        const retry = await admin.from('prospects').insert(stripped).select('id');
        ins = retry.data; insErr = retry.error;
      }
      if (insErr) return j(500, { error: `insert failed: ${insErr.message}`, scanned });
      inserted = ins?.length ?? 0;
    }

    return j(200, { inserted, scanned, exemples: examples });
  } catch (e) {
    return j(500, { error: (e as Error).message });
  }
});
