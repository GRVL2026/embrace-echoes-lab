import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Constitue une base de prospects à partir d'un code NAF, via l'API gouvernementale
// GRATUITE recherche-entreprises.api.gouv.fr (pas de clé, ~7 req/s, aucun crédit Pappers).
//
// Pappers reste nécessaire UNIQUEMENT pour filtrer par date de création (détection de
// nouveaux établissements) : ce filtre est silencieusement ignoré par l'API gouv.
// Pour constituer une base complète d'un secteur, l'API gouv suffit et ne coûte rien.
//
// Exemple : { "naf": "55.30Z", "segment": "camping", "tag": "Camping" } → ~6900 campings.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const API_BASE = 'https://recherche-entreprises.api.gouv.fr/search';
const PER_PAGE = 25;              // maximum autorisé par l'API
const RATE_LIMIT_MS = 160;        // ~6 req/s, sous la limite annoncée de 7
const PAGES_PAR_APPEL = 80;       // ~2000 sociétés par invocation, pour rester sous le timeout
const INSERT_BATCH = 500;

type Dirigeant = { nom?: string; prenoms?: string; qualite?: string; type_dirigeant?: string };

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
  // On privilégie le décideur : président, gérant, puis directeur.
  const prioritaire = physiques.find((d) => /président|gérant|directeur/i.test(d.qualite ?? ''));
  return prioritaire ?? physiques[0];
}

// finances = { "2024": { ca, resultat_net } } → CA de l'année la plus récente
function dernierCa(finances: Record<string, { ca?: number }> | undefined): number | null {
  const annees = Object.keys(finances ?? {}).sort();
  if (annees.length === 0) return null;
  return nombreOuNull(finances![annees[annees.length - 1]]?.ca);
}

async function chargerSirenConnus(): Promise<{ prospects: Set<string>; clients: Set<string> }> {
  const prospects = new Set<string>();
  const clients = new Set<string>();

  // Pagination explicite : au-delà de 1000 lignes, PostgREST tronque silencieusement.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('prospects').select('siren').not('siren', 'is', null).range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.siren) prospects.add(String(r.siren));
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('gaia_entreprises').select('siren').not('siren', 'is', null).range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.siren) clients.add(String(r.siren));
    if (!data || data.length < 1000) break;
  }
  return { prospects, clients };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    const departement = body.departement ? String(body.departement).trim() : null;
    const dryRun = body.dry_run === true;
    const pageDepart = Math.max(1, Number(body.page_depart ?? 1));

    if (!naf) return json({ error: "Paramètre « naf » requis (ex. « 55.30Z »)." }, 400);
    if (!segment) return json({ error: "Paramètre « segment » requis (ex. « camping »)." }, 400);

    const { prospects: sirenProspects, clients: sirenClients } = await chargerSirenConnus();

    let scannes = 0;
    let deja_prospect = 0;
    let deja_client = 0;
    let sans_siren = 0;
    let inseres = 0;
    let totalApi: number | null = null;
    let pagesTotal: number | null = null;
    let derniere_page = pageDepart - 1;
    const aInserer: Record<string, unknown>[] = [];
    const vusDansCeRun = new Set<string>();

    for (let i = 0; i < PAGES_PAR_APPEL; i++) {
      const page = pageDepart + i;
      if (pagesTotal !== null && page > pagesTotal) break;

      const url = new URL(API_BASE);
      url.searchParams.set('activite_principale', naf);
      url.searchParams.set('etat_administratif', 'A'); // sociétés actives uniquement
      url.searchParams.set('per_page', String(PER_PAGE));
      url.searchParams.set('page', String(page));
      if (departement) url.searchParams.set('departement', departement);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const corps = await res.text().catch(() => '');
        return json({ error: `API entreprises ${res.status}`, detail: corps.slice(0, 300), derniere_page }, 502);
      }
      const data = await res.json();
      totalApi ??= nombreOuNull(data.total_results);
      pagesTotal ??= nombreOuNull(data.total_pages);
      derniere_page = page;

      const resultats: any[] = data.results ?? [];
      if (resultats.length === 0) break;

      for (const r of resultats) {
        scannes++;
        const siren = r.siren ? String(r.siren) : null;
        if (!siren) { sans_siren++; continue; }
        if (sirenClients.has(siren)) { deja_client++; continue; }   // déjà client : ne pas prospecter
        if (sirenProspects.has(siren) || vusDansCeRun.has(siren)) { deja_prospect++; continue; }
        vusDansCeRun.add(siren);

        const siege = r.siege ?? {};
        const dir = choisirDirigeant(r.dirigeants);
        const lat = nombreOuNull(siege.latitude);
        const lng = nombreOuNull(siege.longitude);

        aInserer.push({
          entreprise: r.nom_complet || r.nom_raison_sociale || `SIREN ${siren}`,
          siren,
          siret: siege.siret ?? null,
          adresse: siege.adresse ?? null,
          ville: siege.libelle_commune ?? null,
          contact_nom: dir ? nomDirigeant(dir) : null,
          contact_role: dir?.qualite ?? null,
          effectif: r.tranche_effectif_salarie ?? null,
          ca_annuel: dernierCa(r.finances),
          activite: r.activite_principale ?? naf,
          segment,
          tag,
          source: 'naf',
          signal: `Import NAF ${naf}${departement ? ` — dép. ${departement}` : ''}`,
          statut: 'nouveau',
          // Coordonnées fournies par l'API : inutile de repasser par le géocodeur.
          lat, lng,
          geocoded_at: lat !== null && lng !== null ? new Date().toISOString() : null,
          geocode_source: lat !== null && lng !== null ? 'insee' : null,
        });
      }

      if (page < (pagesTotal ?? page)) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    if (!dryRun) {
      for (let i = 0; i < aInserer.length; i += INSERT_BATCH) {
        const lot = aInserer.slice(i, i + INSERT_BATCH);
        const { error } = await admin.from('prospects').insert(lot);
        if (error) throw error;
        inseres += lot.length;
      }
    }

    const reste = pagesTotal !== null && derniere_page < pagesTotal;
    return json({
      ok: true,
      dry_run: dryRun,
      naf, segment, tag, departement,
      total_api: totalApi,
      pages_total: pagesTotal,
      pages_traitees: `${pageDepart} → ${derniere_page}`,
      scannes,
      a_inserer: aInserer.length,
      inseres,
      ignores: { deja_prospect, deja_client, sans_siren },
      // Relancer avec ce paramètre pour poursuivre l'import (évite le timeout).
      page_suivante: reste ? derniere_page + 1 : null,
      termine: !reste,
    });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
