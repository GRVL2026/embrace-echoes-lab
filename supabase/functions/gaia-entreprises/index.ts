// Enrichissement des clients Cegid via l'API publique recherche-entreprises.api.gouv.fr
// - Aucun secret / clé requis
// - Deux actions : `enrich-batch` (bourrage progressif via curseur en base) et `refresh` (re-vérification par SIREN)
// - Auth : CRON_SECRET pour pg_cron OU utilisateur admin/direction

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const UA = "ArcadeOS/1.0 (contact: dev@avranches-automatic.fr)";
const BATCH_SIZE = 40;
const REFRESH_BATCH_SIZE = 40;
const RATE_LIMIT_MS = 550; // ~2 req/s max

const CURSOR_KEY = "entreprises_cursor";
const REMATCH_CURSOR_KEY = "rematch_cursor";
const REMATCH_BATCH_SIZE = 30;
const BILANS_CURSOR_KEY = "bilans_cursor";
const BILANS_BATCH_SIZE = 25;
const PAPPERS_API_KEY = Deno.env.get("PAPPERS_API_KEY") ?? "";
const PAPPERS_URL = "https://api.pappers.fr/v2/entreprise";

// ── NAF secteur (validé par Léopaul) ─────────────────────────────────────────
// Clientèle : exploitants de jeux, forains, BEAUCOUP de bowlings, CHR, revendeurs, vending.
// Comparaison avec OU sans point : on normalise les deux côtés.
const NAF_SECTEUR_RAW = [
  "93.29Z","93.21Z","93.11Z","92.00Z",
  "56.30Z","56.10A",
  "55.10Z","55.20Z","55.30Z",
  "59.14Z",
  "46.49Z","46.90Z",
  "47.65Z","47.78C","47.91A","47.91B","47.99B",
  "77.39Z","77.29Z",
  "33.19Z","95.29Z","94.99Z","84.11Z",
];
function normalizeNaf(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
const NAF_SECTEUR = new Set(NAF_SECTEUR_RAW.map(normalizeNaf));
function isSectorNaf(code: string | null | undefined): boolean {
  const n = normalizeNaf(code);
  return n.length > 0 && NAF_SECTEUR.has(n);
}

// ── Utilitaires ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(sarl|sas|sasu|eurl|snc|sci|scea|selarl|ei|ets|ent|entreprise|societe|sté|company|co|inc|ltd|gmbh|bv|nv)\b/gi, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

// Normalisation TOLERANTE pour rematch : retire formes juridiques, ponctuation, accents.
// Renvoie aussi une variante « 2-3 premiers mots significatifs » pour élargir la recherche
// quand le nom Cegid est verbeux (ex. « BOWLING DE ST LO SAS EXPLOITATION LOISIRS »).
function looseName(s: string): string {
  return normalize(s);
}
function keywordsQuery(s: string): string {
  const words = normalize(s).split(" ").filter((w) => w.length >= 3);
  return words.slice(0, 3).join(" ");
}

type ApiResult = {
  siren: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  nature_juridique?: string;
  activite_principale?: string;
  libelle_activite_principale?: string;
  date_creation?: string;
  tranche_effectif_salarie?: string;
  etat_administratif?: string;
  siege?: {
    adresse?: string;
    code_postal?: string;
    ville?: string;
    libelle_commune?: string;
    geo_adresse?: string;
  };
  dirigeants?: Array<any>;
  matching_etablissements?: any[];
  complements?: {
    est_entrepreneur_individuel?: boolean;
  };
  procedure_collective_en_cours?: boolean;
} & Record<string, any>;

function extractProcedure(r: ApiResult): boolean {
  if (typeof r.procedure_collective_en_cours === "boolean") return r.procedure_collective_en_cours;
  // Fallback : nature juridique connue de procédure ? sinon false
  const nj = String(r.nature_juridique ?? "");
  if (/collectiv|redressement|liquidation|sauvegarde/i.test(nj)) return true;
  return false;
}

function extractSiege(r: ApiResult): string {
  const s = r.siege;
  if (!s) return "";
  return s.geo_adresse
    || [s.adresse, s.code_postal, s.libelle_commune || s.ville].filter(Boolean).join(", ");
}

function extractDirigeants(r: ApiResult): any[] {
  const dl = Array.isArray(r.dirigeants) ? r.dirigeants : [];
  return dl.slice(0, 10).map((d: any) => ({
    nom: d.nom || d.nom_complet || null,
    prenoms: d.prenoms || d.prenom || null,
    qualite: d.qualite || d.fonction || null,
    date_naissance: d.date_de_naissance || d.date_naissance || null,
    raison_sociale: d.raison_sociale || d.denomination || null,
    type_dirigeant: d.type_dirigeant || null,
  }));
}

// Retourne null en cas d'erreur transitoire (HTTP !ok / exception réseau).
// Retourne [] uniquement quand l'API répond correctement avec zéro résultat.
async function apiSearch(q: string): Promise<ApiResult[] | null> {
  const url = `${API_BASE}?q=${encodeURIComponent(q)}&per_page=5`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) {
      console.warn("apiSearch HTTP error", res.status, q);
      return null;
    }
    const json = await res.json();
    return Array.isArray(json?.results) ? json.results as ApiResult[] : [];
  } catch (e) {
    console.warn("apiSearch failed", (e as Error).message);
    return null;
  }
}

// ── Cible d'enrichissement : clients avec CA récent OU pièce ouverte ─────────
async function fetchTargetClients(limit: number, afterCode: string | null): Promise<Array<{ code_client: string; name: string }>> {
  // NB: gaia_query enveloppe la requête dans `SELECT ... FROM (%s LIMIT 200) t`.
  // Ne pas ajouter de LIMIT ici (sinon double LIMIT → erreur SQL). On tronque côté TS.
  const sql = `
    with cible as (
      select distinct trim(v.code_client) as code
      from v_gaia_lignes v
      where v.invoice_date >= (now() - interval '24 months')::date
        and coalesce(trim(v.code_client),'') <> ''
      union
      select distinct trim(d.code_client) as code
      from v_gaia_carnet_documents d
      where coalesce(trim(d.code_client),'') <> ''
    )
    select c.code, coalesce(g.name, c.code) as name
    from cible c
    left join gaia_clients g on trim(g.customer_id) = c.code
    ${afterCode ? `where c.code > ${escapeLit(afterCode)}` : ""}
    order by c.code
  `;
  const { data, error } = await admin.rpc("gaia_query", { sql_query: sql });
  if (error) throw new Error(`gaia_query RPC failed: ${error.message}`);
  if (data && !Array.isArray(data) && typeof data === "object" && (data as any).error) {
    throw new Error(`gaia_query error: ${(data as any).error}`);
  }
  if (!Array.isArray(data)) throw new Error(`gaia_query returned unexpected payload: ${JSON.stringify(data)}`);
  const rows = (data as any[]).map((r) => ({ code_client: String(r.code), name: String(r.name ?? r.code) }));
  return rows.slice(0, Math.max(1, limit));
}

function escapeLit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function loadCursor(): Promise<string | null> {
  const { data } = await admin.from("gaia_config").select("value").eq("key", CURSOR_KEY).maybeSingle();
  const v = (data as any)?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    // Compat : ancien format JSON stringifié {"code":"..."}
    if (s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed.code === "string") return parsed.code || null;
      } catch { /* ignore, fallback ci-dessous */ }
      return null;
    }
    return s;
  }
  if (typeof v === "object" && (v as any).code) return String((v as any).code);
  return null;
}

async function saveCursor(code: string | null) {
  await admin.from("gaia_config").upsert({ key: CURSOR_KEY, value: code ?? null }, { onConflict: "key" });
}

// ── Actions ──────────────────────────────────────────────────────────────────

type MatchOutcome = {
  match_statut: "auto" | "a_valider" | "introuvable";
  siren: string | null;
  denomination: string | null;
  forme_juridique: string | null;
  date_creation: string | null;
  effectif_tranche: string | null;
  dirigeants: any[];
  adresse_siege: string | null;
  etat_administratif: string | null;
  procedure_collective: boolean;
  code_naf: string | null;
  libelle_naf: string | null;
  candidats: any[];
};

function makeCandidat(r: ApiResult, score: number) {
  const naf = r.activite_principale || null;
  return {
    siren: r.siren,
    nom: r.nom_complet || r.nom_raison_sociale,
    forme: r.nature_juridique,
    ville: r.siege?.libelle_commune || r.siege?.ville,
    date_creation: r.date_creation,
    etat_administratif: r.etat_administratif,
    procedure_collective: extractProcedure(r),
    code_naf: naf,
    libelle_naf: r.libelle_activite_principale || null,
    is_secteur: isSectorNaf(naf),
    score: Math.round(score * 100) / 100,
  };
}

function autoOutcome(r: ApiResult): MatchOutcome {
  return {
    match_statut: "auto",
    siren: r.siren,
    denomination: r.nom_complet || r.nom_raison_sociale || null,
    forme_juridique: r.nature_juridique || null,
    date_creation: r.date_creation || null,
    effectif_tranche: r.tranche_effectif_salarie || null,
    dirigeants: extractDirigeants(r),
    adresse_siege: extractSiege(r) || null,
    etat_administratif: r.etat_administratif || null,
    procedure_collective: extractProcedure(r),
    code_naf: r.activite_principale || null,
    libelle_naf: r.libelle_activite_principale || null,
    candidats: [],
  };
}

function emptyOutcome(statut: "introuvable" | "a_valider", candidats: any[]): MatchOutcome {
  return {
    match_statut: statut,
    siren: null, denomination: null, forme_juridique: null, date_creation: null,
    effectif_tranche: null, dirigeants: [], adresse_siege: null,
    etat_administratif: null, procedure_collective: false,
    code_naf: null, libelle_naf: null,
    candidats,
  };
}

// SCORING (validé par Léopaul) : NAF = DÉPARTAGEUR, jamais couperet.
// (a) nom quasi-exact + NAF secteur → auto, même si plusieurs candidats mais UN SEUL en secteur.
// (b) nom quasi-exact + NAF hors secteur → auto SI c'est le seul candidat plausible
//     (la boulangerie qui achète un flipper existe).
// (c) plusieurs candidats plausibles dont plusieurs en NAF secteur → 'a_valider',
//     candidats secteur triés en premier.
// `sectorOnlyAuto` : mode rematch/tolérant → n'accepter auto que si NAF secteur.
function chooseMatch(clientName: string, results: ApiResult[], sectorOnlyAuto = false): MatchOutcome {
  if (!results.length) return emptyOutcome("introuvable", []);

  const scored = results.map((r) => ({
    r,
    score: similarity(clientName, r.nom_complet || r.nom_raison_sociale || ""),
    sector: isSectorNaf(r.activite_principale),
  }));

  // Tri : score DESC puis secteur d'abord à score égal
  scored.sort((a, b) => (b.score - a.score) || (Number(b.sector) - Number(a.sector)));

  const NAME_QUASI_EXACT = 0.82;
  const PLAUSIBLE = 0.4;
  const plausibles = scored.filter((s) => s.score >= PLAUSIBLE);

  // Candidats plausibles avec NAF secteur
  const sectorPlausibles = plausibles.filter((s) => s.sector);
  // Candidats plausibles avec nom quasi-exact
  const nearNamePlausibles = plausibles.filter((s) => s.score >= NAME_QUASI_EXACT);

  // (a) nom quasi-exact + UN SEUL candidat en NAF secteur → auto (même si d'autres candidats existent)
  const sectorNearName = nearNamePlausibles.filter((s) => s.sector);
  if (sectorNearName.length === 1) {
    return autoOutcome(sectorNearName[0].r);
  }

  // (b) nom quasi-exact + hors secteur → auto SI c'est le seul candidat plausible
  //     (mode rematch tolérant : on refuse ce cas, on renvoie 'a_valider').
  if (!sectorOnlyAuto && nearNamePlausibles.length === 1 && plausibles.length === 1) {
    return autoOutcome(nearNamePlausibles[0].r);
  }

  // (c) plusieurs candidats plausibles : 'a_valider' avec secteur en tête
  if (plausibles.length === 0) return emptyOutcome("introuvable", []);
  const ordered = [
    ...sectorPlausibles.slice(0, 5),
    ...plausibles.filter((s) => !s.sector).slice(0, Math.max(0, 5 - sectorPlausibles.length)),
  ];
  const cands = ordered.slice(0, 5).map((s) => makeCandidat(s.r, s.score));
  return emptyOutcome("a_valider", cands);
}

async function upsertResult(code: string, name: string, m: MatchOutcome) {
  await admin.from("gaia_entreprises").upsert({
    code_client: code,
    siren: m.siren,
    denomination: m.denomination ?? name,
    forme_juridique: m.forme_juridique,
    date_creation: m.date_creation,
    effectif_tranche: m.effectif_tranche,
    dirigeants: m.dirigeants,
    adresse_siege: m.adresse_siege,
    etat_administratif: m.etat_administratif,
    procedure_collective: m.procedure_collective,
    code_naf: m.code_naf,
    libelle_naf: m.libelle_naf,
    match_statut: m.match_statut,
    candidats: m.candidats,
    maj: new Date().toISOString(),
  }, { onConflict: "code_client" });
}


async function enrichBatch() {
  const cursor = await loadCursor();
  const targets = await fetchTargetClients(BATCH_SIZE, cursor);
  if (targets.length === 0) {
    // Fin de balayage — on remet le curseur à zéro pour la prochaine passe.
    await saveCursor(null);
    return { ok: true, done: true, processed: 0, cursor: null };
  }
  const stats = { auto: 0, a_valider: 0, introuvable: 0, skipped: 0 };
  for (const t of targets) {
    try {
      const results = await apiSearch(t.name);
      if (results === null) {
        // Erreur transitoire (HTTP !ok / réseau) : on ne crée AUCUNE ligne,
        // le client sera retenté au prochain lot.
        stats.skipped++;
      } else {
        const outcome = chooseMatch(t.name, results);
        await upsertResult(t.code_client, t.name, outcome);
        stats[outcome.match_statut]++;
      }
    } catch (e) {
      console.warn("enrich failed for", t.code_client, (e as Error).message);
      stats.skipped++;
    }
    await sleep(RATE_LIMIT_MS);
  }
  const lastCode = targets[targets.length - 1].code_client;
  await saveCursor(lastCode);
  return { ok: true, done: false, processed: targets.length, next_cursor: lastCode, stats };
}

async function refresh() {
  // Recharge par lots les SIREN déjà rattachés (auto ou valide) — priorité aux plus anciens.
  const { data: rows } = await admin
    .from("gaia_entreprises")
    .select("code_client, siren, denomination")
    .in("match_statut", ["auto", "valide"])
    .not("siren", "is", null)
    .order("maj", { ascending: true })
    .limit(REFRESH_BATCH_SIZE);

  const list = (rows ?? []) as Array<{ code_client: string; siren: string; denomination: string | null }>;
  let updated = 0, procedures = 0, cessees = 0;
  for (const r of list) {
    try {
      const results = await apiSearch(r.siren);
      if (results === null) { await sleep(RATE_LIMIT_MS); continue; }
      const hit = results.find((x) => x.siren === r.siren) ?? results[0];
      if (!hit) { await sleep(RATE_LIMIT_MS); continue; }
      const proc = extractProcedure(hit);
      const etat = hit.etat_administratif || null;
      await admin.from("gaia_entreprises").update({
        etat_administratif: etat,
        procedure_collective: proc,
        forme_juridique: hit.nature_juridique || undefined,
        effectif_tranche: hit.tranche_effectif_salarie || undefined,
        dirigeants: extractDirigeants(hit),
        adresse_siege: extractSiege(hit) || undefined,
        code_naf: hit.activite_principale || undefined,
        libelle_naf: hit.libelle_activite_principale || undefined,
        maj: new Date().toISOString(),
      }).eq("code_client", r.code_client);
      updated++;
      if (proc) procedures++;
      if (etat === "C") cessees++;
    } catch (e) {
      console.warn("refresh failed for", r.code_client, (e as Error).message);
    }
    await sleep(RATE_LIMIT_MS);
  }
  return { ok: true, refreshed: updated, procedures, cessees, checked: list.length };
}

async function validateCandidate(code_client: string, siren: string | null) {
  if (!siren) {
    // "aucun" — on marque introuvable manuellement (statut valide vide).
    await admin.from("gaia_entreprises").update({
      match_statut: "introuvable",
      candidats: [],
      siren: null,
      maj: new Date().toISOString(),
    }).eq("code_client", code_client);
    return { ok: true };
  }
  const results = await apiSearch(siren);
  if (results === null) return { ok: false, error: "API recherche-entreprises indisponible, réessayez" };
  const hit = results.find((r) => r.siren === siren) ?? results[0];
  if (!hit) return { ok: false, error: "SIREN introuvable dans l'API" };
  await admin.from("gaia_entreprises").update({
    siren: hit.siren,
    denomination: hit.nom_complet || hit.nom_raison_sociale || null,
    forme_juridique: hit.nature_juridique || null,
    date_creation: hit.date_creation || null,
    effectif_tranche: hit.tranche_effectif_salarie || null,
    dirigeants: extractDirigeants(hit),
    adresse_siege: extractSiege(hit) || null,
    etat_administratif: hit.etat_administratif || null,
    procedure_collective: extractProcedure(hit),
    code_naf: hit.activite_principale || null,
    libelle_naf: hit.libelle_activite_principale || null,
    match_statut: "valide",
    candidats: [],
    maj: new Date().toISOString(),
  }).eq("code_client", code_client);
  return { ok: true };
}

// ── Rematch : re-scoring NAF sur les 'a_valider' et 'introuvable' ────────────
// N'AFFECTE PAS les lignes 'auto' ou 'valide' existantes.

async function loadRematchCursor(): Promise<string | null> {
  const { data } = await admin.from("gaia_config").select("value").eq("key", REMATCH_CURSOR_KEY).maybeSingle();
  const v = (data as any)?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") { const s = v.trim(); return s || null; }
  return null;
}
async function saveRematchCursor(code: string | null) {
  await admin.from("gaia_config").upsert({ key: REMATCH_CURSOR_KEY, value: code ?? null }, { onConflict: "key" });
}

async function rematchBatch() {
  const cursor = await loadRematchCursor();
  const query = admin
    .from("gaia_entreprises")
    .select("code_client, denomination, match_statut")
    .in("match_statut", ["a_valider", "introuvable"])
    .order("code_client")
    .limit(REMATCH_BATCH_SIZE);
  const { data: rows, error } = cursor ? await query.gt("code_client", cursor) : await query;
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as Array<{ code_client: string; denomination: string | null; match_statut: string }>;
  if (list.length === 0) {
    await saveRematchCursor(null);
    return { ok: true, done: true, processed: 0, cursor: null };
  }
  const stats = { promu_auto: 0, a_valider: 0, introuvable: 0, skipped: 0 };
  for (const r of list) {
    const name = (r.denomination ?? r.code_client).trim();
    try {
      const previousStatut = r.match_statut;
      // 1er essai : nom tel quel (normalisation standard côté similarity)
      let results = await apiSearch(name);
      // 2e essai (introuvables) : mots-clés courts
      if (previousStatut === "introuvable" && (results?.length ?? 0) === 0) {
        const kw = keywordsQuery(name);
        if (kw && kw !== looseName(name)) {
          await sleep(RATE_LIMIT_MS);
          results = await apiSearch(kw);
        }
      }
      if (results === null) { stats.skipped++; await sleep(RATE_LIMIT_MS); continue; }

      // Pour 'introuvable' → n'accepter auto QUE si NAF secteur (sectorOnlyAuto = true).
      // Pour 'a_valider' → règles (a)/(b) normales appliquées.
      const sectorOnlyAuto = previousStatut === "introuvable";
      const outcome = chooseMatch(name, results, sectorOnlyAuto);

      // Ne JAMAIS régresser un 'a_valider' vers 'introuvable' juste parce que le rescoring
      // ne trouve plus de candidat plausible (l'humain doit rester maître).
      if (previousStatut === "a_valider" && outcome.match_statut === "introuvable") {
        stats.skipped++;
      } else {
        await upsertResult(r.code_client, name, outcome);
        if (outcome.match_statut === "auto") stats.promu_auto++;
        else if (outcome.match_statut === "a_valider") stats.a_valider++;
        else stats.introuvable++;
      }
    } catch (e) {
      console.warn("rematch failed for", r.code_client, (e as Error).message);
      stats.skipped++;
    }
    await sleep(RATE_LIMIT_MS);
  }
  const lastCode = list[list.length - 1].code_client;
  await saveRematchCursor(lastCode);
  return { ok: true, done: false, processed: list.length, next_cursor: lastCode, stats };
}

// ── Bilans (Pappers) ─────────────────────────────────────────────────────────

async function loadBilansCursor(): Promise<string | null> {
  const { data } = await admin.from("gaia_config").select("value").eq("key", BILANS_CURSOR_KEY).maybeSingle();
  const v = (data as any)?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s || null;
  }
  return null;
}

async function saveBilansCursor(code: string | null) {
  await admin.from("gaia_config").upsert(
    { key: BILANS_CURSOR_KEY, value: code ?? null },
    { onConflict: "key" },
  );
}

// Cible = mêmes clients que l'enrichissement (CA 24 mois OU pièce ouverte),
// filtrés à ceux dont le SIREN est rattaché (auto/valide) et par curseur.
async function fetchBilansTargets(limit: number, afterCode: string | null): Promise<Array<{ code_client: string; siren: string }>> {
  const sql = `
    with cible as (
      select distinct trim(v.code_client) as code
      from v_gaia_lignes v
      where v.invoice_date >= (now() - interval '24 months')::date
        and coalesce(trim(v.code_client),'') <> ''
      union
      select distinct trim(d.code_client) as code
      from v_gaia_carnet_documents d
      where coalesce(trim(d.code_client),'') <> ''
    )
    select e.code_client as code, e.siren
    from gaia_entreprises e
    join cible c on c.code = e.code_client
    where e.siren is not null
      and e.match_statut in ('auto','valide')
      and (e.bilans_maj is null or e.bilans_maj < now() - interval '20 days')
      ${afterCode ? `and e.code_client > ${escapeLit(afterCode)}` : ""}
    order by e.code_client
  `;
  const { data, error } = await admin.rpc("gaia_query", { sql_query: sql });
  if (error) throw new Error(`gaia_query RPC failed: ${error.message}`);
  if (data && !Array.isArray(data) && typeof data === "object" && (data as any).error) {
    throw new Error(`gaia_query error: ${(data as any).error}`);
  }
  if (!Array.isArray(data)) throw new Error(`gaia_query returned unexpected payload: ${JSON.stringify(data)}`);
  const rows = (data as any[]).map((r) => ({ code_client: String(r.code), siren: String(r.siren) }));
  return rows.slice(0, Math.max(1, limit));
}

type PappersFetchResult =
  | { ok: true; comptes_publies: boolean; bilans: any[] }
  | { ok: false; transient: boolean };

function pickNumber(...vals: any[]): number | null {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractBilansFromPappers(json: any): { comptes_publies: boolean; bilans: any[] } {
  const finances: any[] = Array.isArray(json?.finances) ? json.finances : [];
  const comptes: any[] = Array.isArray(json?.comptes) ? json.comptes : [];
  const source = finances.length > 0 ? finances : comptes;
  if (source.length === 0) return { comptes_publies: false, bilans: [] };
  const normalized = source
    .map((b: any) => {
      const annee = b.annee ?? b.date_cloture_exercice?.slice?.(0, 4) ?? b.date_de_cloture_exercice?.slice?.(0, 4) ?? null;
      return {
        annee_cloture: annee ? Number(annee) : null,
        ca: pickNumber(b.chiffre_affaires, b.ca, b.chiffre_d_affaires),
        resultat_net: pickNumber(b.resultat, b.resultat_net),
        capitaux_propres: pickNumber(b.capitaux_propres, b.capitaux_propres_net),
        effectif: pickNumber(b.effectif),
      };
    })
    .filter((b) => b.annee_cloture !== null);
  normalized.sort((a, b) => (b.annee_cloture ?? 0) - (a.annee_cloture ?? 0));
  const top3 = normalized.slice(0, 3);
  return { comptes_publies: top3.length > 0, bilans: top3 };
}

async function fetchPappers(siren: string): Promise<PappersFetchResult> {
  if (!PAPPERS_API_KEY) return { ok: false, transient: true };
  const url = `${PAPPERS_URL}?api_token=${encodeURIComponent(PAPPERS_API_KEY)}&siren=${encodeURIComponent(siren)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 404) {
      // SIREN valide mais aucune donnée publiée
      return { ok: true, comptes_publies: false, bilans: [] };
    }
    if (res.status === 429 || res.status >= 500) {
      console.warn("Pappers transient", res.status, siren);
      return { ok: false, transient: true };
    }
    if (!res.ok) {
      console.warn("Pappers HTTP error", res.status, siren);
      return { ok: false, transient: false };
    }
    const json = await res.json();
    const { comptes_publies, bilans } = extractBilansFromPappers(json);
    return { ok: true, comptes_publies, bilans };
  } catch (e) {
    console.warn("Pappers fetch failed", (e as Error).message);
    return { ok: false, transient: true };
  }
}

async function bilansBatch() {
  if (!PAPPERS_API_KEY) {
    return { ok: false, error: "PAPPERS_API_KEY manquante" };
  }
  const cursor = await loadBilansCursor();
  const targets = await fetchBilansTargets(BILANS_BATCH_SIZE, cursor);
  if (targets.length === 0) {
    await saveBilansCursor(null);
    return { ok: true, done: true, processed: 0, cursor: null, note: "tous les bilans sont à jour (aucune cible non traitée ou plus vieille que 20 jours)" };
  }
  const stats = { updated: 0, sans_comptes: 0, skipped: 0, echec: 0 };
  for (const t of targets) {
    const r = await fetchPappers(t.siren);
    if (!r.ok) {
      if (r.transient) stats.skipped++;
      else stats.echec++;
      // Erreur transitoire : on ne touche pas la ligne, on ne bloque pas.
      await sleep(1050);
      continue;
    }
    await admin.from("gaia_entreprises").update({
      bilans: r.bilans.length > 0 ? r.bilans : null,
      comptes_publies: r.comptes_publies,
      bilans_maj: new Date().toISOString(),
    }).eq("code_client", t.code_client);
    if (r.comptes_publies) stats.updated++;
    else stats.sans_comptes++;
    await sleep(1050); // 1 req/s max
  }
  const lastCode = targets[targets.length - 1].code_client;
  await saveBilansCursor(lastCode);
  return { ok: true, done: false, processed: targets.length, next_cursor: lastCode, stats };
}


// ── Auth ─────────────────────────────────────────────────────────────────────

async function isAllowed(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? url.searchParams.get("secret") ?? "";
  if (CRON_SECRET && cronHeader === CRON_SECRET) return true;
  if (cronHeader) {
    const { data: cfg } = await admin.from("gaia_config").select("value").eq("key", "cron_secret").maybeSingle();
    if ((cfg as any)?.value && cronHeader === (cfg as any).value) return true;
  }
  if (!bearer) return false;
  const { data: userData } = await admin.auth.getUser(bearer);
  const uid = userData?.user?.id;
  if (!uid) return false;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
  return (roles ?? []).some((r: any) => r.role === "admin" || r.role === "direction");
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await isAllowed(req))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || new URL(req.url).searchParams.get("action") || "enrich-batch";

    let result: any;
    if (action === "enrich-batch") result = await enrichBatch();
    else if (action === "refresh") result = await refresh();
    else if (action === "rematch") result = await rematchBatch();
    else if (action === "bilans") result = await bilansBatch();
    else if (action === "validate") result = await validateCandidate(String(body.code_client || ""), body.siren ? String(body.siren) : null);
    else if (action === "reset-cursor") { await saveCursor(null); result = { ok: true }; }
    else if (action === "reset-rematch-cursor") { await saveRematchCursor(null); result = { ok: true }; }
    else if (action === "reset-bilans-cursor") { await saveBilansCursor(null); result = { ok: true }; }
    else result = { ok: false, error: `Unknown action: ${action}` };

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("gaia-entreprises error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
