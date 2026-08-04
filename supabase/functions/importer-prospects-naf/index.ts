import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Constitue une base de prospects à partir d'un code NAF, via l'API gouvernementale
// GRATUITE recherche-entreprises.api.gouv.fr (pas de clé, ~7 req/s, aucun crédit Pappers).
//
// Pappers reste nécessaire UNIQUEMENT pour filtrer par date de création (détection de
// nouveaux établissements) : ce filtre est silencieusement ignoré par l'API gouv.
//
// UN PROSPECT = UN ÉTABLISSEMENT, pas une société. Un groupe comme HOMAIR VACANCES
// (112 établissements) donne autant de prospects que de campings exploités, chacun avec
// sa propre adresse et ses coordonnées — le gérant d'un site franchisé décide souvent
// seul de ses besoins. La colonne `groupe` indique l'enseigne de rattachement, vide pour
// un indépendant.
//
// ⚠️ L'énumération des établissements suppose de filtrer par département : sans ce filtre
// l'API ne renvoie qu'un échantillon d'établissements par société. Passer `departements`.
//
// Exemple : { "naf":"55.30Z", "segment":"camping", "tag":"Camping", "departements":"85,17,44" }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const API_BASE = 'https://recherche-entreprises.api.gouv.fr/search';
const API_UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)';
const PER_PAGE = 25;              // maximum autorisé par l'API
// L'API annonce 7 req/s, mais l'adresse IP de sortie est mutualisée entre locataires
// Supabase : à ~6 req/s on récoltait des 429. On se cale nettement en dessous.
const RATE_LIMIT_MS = 400;        // ~2,5 req/s
const PAGES_PAR_APPEL = 200;      // plafond de sécurité ; c'est le budget de TEMPS qui arrête
// Les edge functions sont coupées à 150 s. On rend la main avant, avec de quoi reprendre.
const BUDGET_MS = 110_000;
const INSERT_BATCH = 500;

// Un 429 ou une indisponibilité passagère ne doit pas faire échouer tout l'import :
// on réessaie en espaçant, et on ne renonce qu'ensuite.
async function fetchApi(url: string): Promise<Response> {
  let res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': API_UA } });
  for (let essai = 0; !res.ok && [429, 502, 503, 504].includes(res.status) && essai < 3; essai++) {
    await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, essai)));
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': API_UA } });
  }
  return res;
}

type Dirigeant = { nom?: string; prenoms?: string; qualite?: string; type_dirigeant?: string };
type Etab = {
  siret?: string; adresse?: string; code_postal?: string; libelle_commune?: string;
  latitude?: string | number; longitude?: string | number;
  nom_commercial?: string; liste_enseignes?: string[] | null;
  tranche_effectif_salarie?: string | null; etat_administratif?: string;
};

const nombreOuNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// « AXEL MICHEL CHRISTO » + « PENIN » → « Axel PENIN » (un seul prénom, plus lisible)
function nomDirigeant(d: Dirigeant): string | null {
  const nom = (d.nom ?? '').trim();
  const prenom = (d.prenoms ?? '').trim().split(/\s+/)[0] ?? '';
  if (!nom && !prenom) return null;
  const p = prenom ? prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase() : '';
  return [p, nom.toUpperCase()].filter(Boolean).join(' ');
}

function choisirDirigeant(dirigeants: Dirigeant[] | undefined): Dirigeant | null {
  const physiques = (dirigeants ?? []).filter((d) => d.type_dirigeant === 'personne physique');
  if (physiques.length === 0) return null;
  const prioritaire = physiques.find((d) => /président|gérant|directeur/i.test(d.qualite ?? ''));
  return prioritaire ?? physiques[0];
}

// finances = { "2024": { ca } } → CA de l'année la plus récente
function dernierCa(finances: Record<string, { ca?: number }> | undefined): number | null {
  const annees = Object.keys(finances ?? {}).sort();
  if (annees.length === 0) return null;
  return nombreOuNull(finances![annees[annees.length - 1]]?.ca);
}

// Nom affiché du camping : l'enseigne du site avant la raison sociale de la société.
function nomEtablissement(e: Etab, societe: string): string {
  const enseigne = (e.nom_commercial || (e.liste_enseignes ?? [])[0] || '').trim();
  if (enseigne) return enseigne;
  const commune = (e.libelle_commune ?? '').trim();
  return commune ? `${societe} — ${commune}` : societe;
}

async function chargerConnus(): Promise<{ sirets: Set<string>; sirenClients: Set<string> }> {
  const sirets = new Set<string>();
  const sirenClients = new Set<string>();
  // Pagination explicite : au-delà de 1000 lignes, PostgREST tronque silencieusement.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('prospects').select('siret').not('siret', 'is', null).range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.siret) sirets.add(String(r.siret));
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('gaia_entreprises').select('siren').not('siren', 'is', null).range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.siren) sirenClients.add(String(r.siren));
    if (!data || data.length < 1000) break;
  }
  return { sirets, sirenClients };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  // Auth : cron (x-cron-secret) OU utilisateur admin/direction connecté.
  const isCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET;
  if (!isCron) {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    const ok = (roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    if (!ok) return json({ error: 'Forbidden' }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const naf = String(body.naf ?? '').trim();
    const segment = String(body.segment ?? '').trim();
    const tag = String(body.tag ?? '').trim() || null;
    const dryRun = body.dry_run === true;

    if (!naf) return json({ error: "Paramètre « naf » requis (ex. « 55.30Z »)." }, 400);
    if (!segment) return json({ error: "Paramètre « segment » requis (ex. « camping »)." }, 400);

    // Liste de départements à parcourir (vide = une seule passe nationale, moins exhaustive).
    const deps: string[] = Array.isArray(body.departements)
      ? body.departements.map((d: unknown) => String(d).trim()).filter(Boolean)
      : String(body.departements ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const listeDeps: (string | null)[] = deps.length ? deps : [null];

    // Reprise après interruption : on redémarre à ce département / cette page.
    const depDepart = body.departement_depart ? String(body.departement_depart).trim() : null;
    const pageDepart = Math.max(1, Number(body.page_depart ?? 1));

    const { sirets, sirenClients } = await chargerConnus();

    let scannes = 0, deja_prospect = 0, deja_client = 0, sans_siret = 0, inseres = 0;
    let etablissements_groupe = 0, budget = PAGES_PAR_APPEL;
    const aInserer: Record<string, unknown>[] = [];
    const vus = new Set<string>();
    const parDepartement: Record<string, number> = {};
    let reprise: { departement: string | null; page: number } | null = null;

    const iDepart = depDepart ? Math.max(0, listeDeps.indexOf(depDepart)) : 0;
    const debut = Date.now();
    const tempsEcoule = () => Date.now() - debut > BUDGET_MS;

    for (let di = iDepart; di < listeDeps.length && budget > 0 && !tempsEcoule(); di++) {
      const dep = listeDeps[di];
      let page = di === iDepart ? pageDepart : 1;
      let pagesTotal: number | null = null;

      while (budget > 0 && !tempsEcoule()) {
        const url = new URL(API_BASE);
        url.searchParams.set('activite_principale', naf);
        url.searchParams.set('etat_administratif', 'A');
        url.searchParams.set('per_page', String(PER_PAGE));
        url.searchParams.set('page', String(page));
        if (dep) url.searchParams.set('departement', dep);

        const res = await fetchApi(url.toString());
        if (!res.ok) {
          const corps = await res.text().catch(() => '');
          // On n'abandonne pas ce qui a déjà été collecté : on l'insère avant de rendre la main.
          if (!dryRun && aInserer.length) {
            for (let i = 0; i < aInserer.length; i += INSERT_BATCH) {
              const lot = aInserer.slice(i, i + INSERT_BATCH);
              const { error: e } = await admin.from('prospects').insert(lot);
              if (e) throw e;
              inseres += lot.length;
            }
          }
          return json({ error: `API entreprises ${res.status}`, detail: corps.slice(0, 200),
                        inseres, reprise: { departement: dep, page } }, 502);
        }
        const data = await res.json();
        pagesTotal ??= nombreOuNull(data.total_pages);
        budget--;

        const resultats: any[] = data.results ?? [];
        if (resultats.length === 0) break;

        for (const r of resultats) {
          const societe = r.nom_complet || r.nom_raison_sociale || `SIREN ${r.siren}`;
          const siren = r.siren ? String(r.siren) : null;
          const dir = choisirDirigeant(r.dirigeants);
          const nbEtabs = Number(r.nombre_etablissements_ouverts ?? 1);
          const estGroupe = nbEtabs > 1;

          // Établissements retenus : ceux qui correspondent à la recherche. À défaut, le siège.
          const etabs: Etab[] = (r.matching_etablissements ?? []).length
            ? r.matching_etablissements
            : (r.siege ? [r.siege] : []);

          for (const e of etabs) {
            scannes++;
            const siret = e.siret ? String(e.siret) : null;
            if (!siret) { sans_siret++; continue; }
            if (e.etat_administratif && e.etat_administratif !== 'A') continue;
            if (siren && sirenClients.has(siren)) { deja_client++; continue; }
            if (sirets.has(siret) || vus.has(siret)) { deja_prospect++; continue; }
            vus.add(siret);
            if (estGroupe) etablissements_groupe++;

            const lat = nombreOuNull(e.latitude);
            const lng = nombreOuNull(e.longitude);
            const cle = dep ?? 'national';
            parDepartement[cle] = (parDepartement[cle] ?? 0) + 1;

            aInserer.push({
              entreprise: nomEtablissement(e, societe),
              siren, siret,
              adresse: e.adresse ?? null,
              ville: e.libelle_commune ?? null,
              // Pour un site de groupe, le dirigeant est celui du siège, pas le gérant du
              // camping : à compléter par une recherche LinkedIn / Sales Navigator.
              contact_nom: dir ? nomDirigeant(dir) : null,
              contact_role: dir ? (estGroupe ? `${dir.qualite ?? 'Dirigeant'} (siège)` : dir.qualite ?? null) : null,
              effectif: e.tranche_effectif_salarie ?? r.tranche_effectif_salarie ?? null,
              // Le CA n'existe qu'au niveau société : l'attribuer à un site d'un groupe
              // donnerait un chiffre trompeur (424 M€ sur un seul camping).
              ca_annuel: estGroupe ? null : dernierCa(r.finances),
              activite: r.activite_principale ?? naf,
              segment, tag,
              groupe: estGroupe ? societe : null,
              source: 'naf',
              signal: estGroupe
                ? `Import NAF ${naf} — site du groupe ${societe} (${nbEtabs} établissements)`
                : `Import NAF ${naf} — exploitant indépendant`,
              statut: 'nouveau',
              lat, lng,
              geocoded_at: lat !== null && lng !== null ? new Date().toISOString() : null,
              geocode_source: lat !== null && lng !== null ? 'insee' : null,
            });
          }
        }

        page++;
        if (pagesTotal !== null && page > pagesTotal) break;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      }

      // Arrêt anticipé (temps ou plafond de pages) : on note où reprendre, dans ce
      // département s'il reste des pages, sinon au département suivant.
      const departementInacheve = pagesTotal !== null && page <= pagesTotal;
      if (budget <= 0 || tempsEcoule()) {
        reprise = departementInacheve
          ? { departement: dep, page }
          : (di + 1 < listeDeps.length ? { departement: listeDeps[di + 1], page: 1 } : null);
        break;
      }
    }

    if (!dryRun) {
      for (let i = 0; i < aInserer.length; i += INSERT_BATCH) {
        const lot = aInserer.slice(i, i + INSERT_BATCH);
        const { error } = await admin.from('prospects').insert(lot);
        if (error) throw error;
        inseres += lot.length;
      }
    }

    return json({
      ok: true, dry_run: dryRun, naf, segment, tag,
      departements: deps.length ? deps : ['(national)'],
      scannes,
      a_inserer: aInserer.length,
      inseres,
      dont_sites_de_groupe: etablissements_groupe,
      par_departement: parDepartement,
      ignores: { deja_prospect, deja_client, sans_siret },
      reprise,               // à repasser en departement_depart / page_depart si non nul
      termine: reprise === null,
    });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
