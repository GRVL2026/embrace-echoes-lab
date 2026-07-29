// Wrapper pour l'API publique française https://recherche-entreprises.api.gouv.fr
// Gratuite, sans clé, ~7 req/s. Remplace tous les appels /v2/entreprise de Pappers.

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const UA = "ArcadeOS/1.0 (contact: dev@avranches-automatic.fr)";
export const GOUV_RATE_LIMIT_MS = 250; // ~4 req/s (limite officielle 7 req/s)

export async function gouvSearch(q: string, perPage = 5): Promise<any[] | null> {
  const url = `${API_BASE}?q=${encodeURIComponent(q)}&per_page=${perPage}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j?.results) ? j.results : [];
  } catch {
    return null;
  }
}

export async function gouvBySiren(siren: string): Promise<any | null> {
  const cleaned = String(siren).replace(/\D/g, "").slice(0, 9);
  if (!cleaned) return null;
  const results = await gouvSearch(cleaned, 1);
  if (!results || results.length === 0) return null;
  return results.find((r: any) => String(r.siren) === cleaned) ?? results[0];
}

function pick<T>(...vals: (T | null | undefined | "")[]): T | null {
  for (const v of vals) if (v !== null && v !== undefined && v !== "") return v as T;
  return null;
}
function joinAddr(parts: (string | null | undefined)[]): string | null {
  const s = parts.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join(", ");
  return s || null;
}

/** Premier dirigeant personne physique du hit gouv. */
export function extractDirigeantPP(hit: any): { nom: string | null; role: string | null } {
  const dl = Array.isArray(hit?.dirigeants) ? hit.dirigeants : [];
  const pp = dl.find((d: any) => {
    const t = String(d?.type_dirigeant ?? "").toLowerCase();
    return t === "personne physique" || t.includes("physique");
  }) ?? dl[0];
  if (!pp) return { nom: null, role: null };
  const prenom = String(pp.prenoms ?? pp.prenom ?? "").trim();
  const nom = String(pp.nom ?? "").trim();
  const full = [prenom, nom].filter(Boolean).join(" ").trim() || null;
  const role = pp.qualite ?? pp.fonction ?? null;
  return { nom: full, role: role ? String(role) : null };
}

/** CA le plus récent depuis finances (objet indexé par année). */
function extractLatestCA(hit: any): number | null {
  const fin = hit?.finances;
  if (!fin || typeof fin !== "object") return null;
  const years = Object.keys(fin).filter((y) => /^\d{4}$/.test(y)).sort().reverse();
  for (const y of years) {
    const v = fin[y]?.ca;
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Mapping "enrichissement prospect" (mêmes clés que l'ancien wrapper Pappers). */
export function extractEnrichissement(hit: any) {
  const s = hit?.siege ?? {};
  const dir = extractDirigeantPP(hit);
  return {
    siret: pick<string>(s.siret, hit?.siret_siege, hit?.siret),
    adresse: pick<string>(
      s.geo_adresse,
      s.adresse,
      joinAddr([s.adresse, s.code_postal, s.libelle_commune ?? s.ville]),
    ),
    effectif: pick<string>(hit?.tranche_effectif_salarie),
    ca_annuel: extractLatestCA(hit),
    activite: pick<string>(hit?.libelle_activite_principale),
    // L'API gouv ne fournit ni téléphone ni site web publics — champs laissés nuls.
    telephone: null,
    site_web: null,
    contact_nom: dir.nom,
    contact_role: dir.role,
  };
}

/** Mapping bilans (compatible avec le format existant : capitaux_propres/effectif = null). */
export function extractBilans(hit: any): { comptes_publies: boolean; bilans: any[] } {
  const fin = hit?.finances;
  if (!fin || typeof fin !== "object") return { comptes_publies: false, bilans: [] };
  const rows = Object.entries(fin)
    .filter(([y]) => /^\d{4}$/.test(y))
    .map(([y, v]: [string, any]) => {
      const ca = v?.ca;
      const rn = v?.resultat_net;
      return {
        annee_cloture: Number(y),
        ca: ca != null && Number.isFinite(Number(ca)) ? Number(ca) : null,
        resultat_net: rn != null && Number.isFinite(Number(rn)) ? Number(rn) : null,
        capitaux_propres: null,
        effectif: null,
      };
    })
    .filter((b) => b.ca !== null || b.resultat_net !== null)
    .sort((a, b) => b.annee_cloture - a.annee_cloture);
  const top3 = rows.slice(0, 3);
  return { comptes_publies: top3.length > 0, bilans: top3 };
}
