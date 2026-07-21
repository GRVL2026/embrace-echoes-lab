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

type ApiResult = {
  siren: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  nature_juridique?: string;
  activite_principale?: string;
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
    // recherche-entreprises n'expose pas toujours la procédure collective directement.
    // On garde le champ pour compatibilité future.
  };
  // Champ éventuel selon la version d'API
  procedure_collective_en_cours?: boolean;
  // Certains résultats exposent `bilans` / `finances`… on n'exploite pas ici.
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
  candidats: any[];
};

function chooseMatch(clientName: string, results: ApiResult[]): MatchOutcome {
  if (!results.length) {
    return { match_statut: "introuvable", siren: null, denomination: null, forme_juridique: null, date_creation: null, effectif_tranche: null, dirigeants: [], adresse_siege: null, etat_administratif: null, procedure_collective: false, candidats: [] };
  }
  const scored = results.map((r) => ({
    r,
    score: similarity(clientName, r.nom_complet || r.nom_raison_sociale || ""),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const auto = top.score >= 0.82 && (!second || (top.score - second.score) >= 0.15);
  if (auto) {
    const r = top.r;
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
      candidats: [],
    };
  }
  // Sinon on liste les candidats plausibles (score >= 0.4)
  const cands = scored.filter((s) => s.score >= 0.4).slice(0, 5).map((s) => ({
    siren: s.r.siren,
    nom: s.r.nom_complet || s.r.nom_raison_sociale,
    forme: s.r.nature_juridique,
    ville: s.r.siege?.libelle_commune || s.r.siege?.ville,
    date_creation: s.r.date_creation,
    etat_administratif: s.r.etat_administratif,
    procedure_collective: extractProcedure(s.r),
    score: Math.round(s.score * 100) / 100,
  }));
  if (cands.length === 0) {
    return { match_statut: "introuvable", siren: null, denomination: null, forme_juridique: null, date_creation: null, effectif_tranche: null, dirigeants: [], adresse_siege: null, etat_administratif: null, procedure_collective: false, candidats: [] };
  }
  return { match_statut: "a_valider", siren: null, denomination: null, forme_juridique: null, date_creation: null, effectif_tranche: null, dirigeants: [], adresse_siege: null, etat_administratif: null, procedure_collective: false, candidats: cands };
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
  const stats = { auto: 0, a_valider: 0, introuvable: 0 };
  for (const t of targets) {
    try {
      const results = await apiSearch(t.name);
      const outcome = chooseMatch(t.name, results);
      await upsertResult(t.code_client, t.name, outcome);
      stats[outcome.match_statut]++;
    } catch (e) {
      console.warn("enrich failed for", t.code_client, (e as Error).message);
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
    match_statut: "valide",
    candidats: [],
    maj: new Date().toISOString(),
  }).eq("code_client", code_client);
  return { ok: true };
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
    else if (action === "validate") result = await validateCandidate(String(body.code_client || ""), body.siren ? String(body.siren) : null);
    else if (action === "reset-cursor") { await saveCursor(null); result = { ok: true }; }
    else result = { ok: false, error: `Unknown action: ${action}` };

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("gaia-entreprises error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
