// Logique pure de l'audit catalogue : parseur de cotes et cohérence des variantes.
//
// Isolée de `index.ts` pour être testable hors Deno — c'est elle qui porte tout le risque du
// module, et une première version non testée sur le vrai catalogue produisait 145 fausses
// alertes sur 148. Le raisonnement derrière chaque seuil est documenté dans `index.ts`.

// Bandes de plausibilité, par notation. Une machine ne descend pas sous 20 cm sur un axe ;
// un accessoire (knob, art blade, écusson) descend jusqu'à quelques centimètres.
export const BANDES = {
  mm: { min: 200, max: 10000 },
  cm: { min: 30, max: 3000 },
} as const;

// Gravité : `bloquant` = les cotes sont inexploitables en l'état.
//           `cosmetique` = exploitables mais hors convention, à corriger au calme.
export const GRAVITE: Record<string, "bloquant" | "cosmetique"> = {
  manquant: "bloquant",
  illisible: "bloquant",
  axe_manquant: "bloquant",
  hors_plage: "bloquant",
  intervalle: "cosmetique",
  ordre_inhabituel: "cosmetique",
  incoherence_variante: "cosmetique",
};


type Analyse = {
  largeur?: number;
  profondeur?: number;
  hauteur?: number;
  notation: "mm" | "cm" | null;
  anomalie: string | null; // null = fiche saine
  detail: string | null;
};

/** Parseur des treize écritures relevées en production.
 *  Principe : chercher CHAQUE axe par sa lettre, indépendamment. L'ordre d'écriture n'a alors
 *  plus d'importance, le séparateur (x, ×, *) non plus, et une inversion L/P ne fausse rien. */
export function analyser(brut: string | null | undefined, specsVoisines = false): Analyse {
  if (!brut || !brut.trim()) {
    // Silence si la fiche technique n'a jamais été commencée : un ballon de basket ou un
    // bouton de flipper n'a pas de cotes à renseigner, et le signaler chaque semaine est du bruit.
    if (!specsVoisines) return { notation: null, anomalie: null, detail: null };
    return {
      notation: null,
      anomalie: "manquant",
      detail: "fiche technique renseignée (d'autres specs_* sont remplies) mais cotes absentes",
    };
  }
  const s = brut.replace(/×/g, "x").trim(); // × (U+00D7) -> x

  if (!/\d/.test(s)) {
    return { notation: null, anomalie: "illisible", detail: `aucun chiffre : « ${brut.trim()} »` };
  }

  const axes: Record<string, number> = {};
  let intervalle = false;
  for (const [lettre, cle] of [["L", "largeur"], ["P", "profondeur"], ["H", "hauteur"]] as const) {
    const m = s.match(new RegExp(`\\b${lettre}\\s*(\\d+(?:[.,]\\d+)?)(\\s*/\\s*(\\d+(?:[.,]\\d+)?))?`, "i"));
    if (!m) continue;
    const nombres = (m[0].match(/\d+(?:[.,]\d+)?/g) || []).map((v) => parseFloat(v.replace(",", ".")));
    if (nombres.length > 1) intervalle = true;
    axes[cle] = Math.max(...nombres);
  }

  // Repli : format nu « 72x26x28 » ou « 24X15X15 », convention des accessoires, en CENTIMÈTRES.
  if (Object.keys(axes).length === 0) {
    const nu = s.match(/^\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (nu) {
      const [a, b, c] = [nu[1], nu[2], nu[3]].map((v) => parseFloat(v.replace(",", ".")) * 10);
      const base = { largeur: a, profondeur: b, hauteur: c, notation: "cm" as const };
      const hors = Object.entries({ largeur: a, profondeur: b, hauteur: c })
        .filter(([, v]) => v < BANDES.cm.min || v > BANDES.cm.max);
      if (hors.length) {
        return {
          ...base,
          anomalie: "hors_plage",
          detail: hors.map(([k, v]) => `${k} = ${v} mm`).join(", ") +
            ` (accessoire, attendu ${BANDES.cm.min}–${BANDES.cm.max} mm)`,
        };
      }
      // Notation nue = convention maison pour les accessoires. Pas une anomalie.
      return { ...base, anomalie: null, detail: null };
    }
    return { notation: null, anomalie: "illisible", detail: `format non reconnu : « ${brut.trim()} »` };
  }

  const base = {
    largeur: axes.largeur,
    profondeur: axes.profondeur,
    hauteur: axes.hauteur,
    notation: "mm" as const,
  };
  const manquants = (["largeur", "profondeur", "hauteur"] as const).filter((k) => axes[k] === undefined);
  if (manquants.length) {
    return { ...base, anomalie: "axe_manquant", detail: `axe(s) sans libellé : ${manquants.join(", ")}` };
  }

  const hors = Object.entries(axes).filter(([, v]) => v < BANDES.mm.min || v > BANDES.mm.max);
  if (hors.length) {
    return {
      ...base,
      anomalie: "hors_plage",
      detail: hors.map(([k, v]) => `${k} = ${v} mm`).join(", ") +
        ` (machine, attendu ${BANDES.mm.min}–${BANDES.mm.max} mm)`,
    };
  }
  if (intervalle) {
    return {
      ...base,
      anomalie: "intervalle",
      detail: "une cote est donnée comme intervalle — la valeur haute est retenue, à confirmer",
    };
  }
  // Ordre d'écriture inhabituel : le parseur lit juste, mais le risque est que les LIBELLÉS
  // soient intervertis à la saisie. Vérification humaine.
  const iL = s.search(/\bL\s*\d/i), iP = s.search(/\bP\s*\d/i);
  if (iL >= 0 && iP >= 0 && iP < iL) {
    return {
      ...base,
      anomalie: "ordre_inhabituel",
      detail: "« P » est écrit avant « L » : vérifier que les libellés ne sont pas intervertis",
    };
  }
  return { ...base, anomalie: null, detail: null };
}

// ── Cohérence entre variantes d'un même jeu ───────────────────────────────────────────────
// Une version standard ne peut pas occuper nettement plus de sol que sa version deluxe.
// Ce détecteur a trouvé l'inversion Halo Fireteam Raven STD / DX. Seuil volontairement haut
// (1,3×) : sur le vrai catalogue il ne se déclenche qu'une fois, ce qui est la bonne forme
// pour un rapport hebdomadaire. Les paliers Stern (Pro/Premium/LE, cotes identiques) et
// Bikers Madness DX/SD (0,97×) passent sans bruit.
const TIER_HAUT = ["dx", "dlx", "deluxe", "premium", "le"];
const TIER_BAS = ["std", "sd", "standard", "pro", "single"];
const SEUIL_INVERSION = 1.3;

export function incoherencesVariantes(
  fiches: { titre: string; largeur?: number; profondeur?: number }[],
): { titre: string; detail: string }[] {
  const groupes = new Map<string, { haut: typeof fiches; bas: typeof fiches }>();
  for (const f of fiches) {
    if (!f.largeur || !f.profondeur) continue;
    const mots = f.titre.trim().split(/\s+/);
    const dernier = mots[mots.length - 1].toLowerCase();
    const palier = TIER_HAUT.includes(dernier) ? "haut" : TIER_BAS.includes(dernier) ? "bas" : null;
    if (!palier) continue;
    const socle = mots.slice(0, -1).join(" ").toLowerCase();
    if (!groupes.has(socle)) groupes.set(socle, { haut: [], bas: [] });
    groupes.get(socle)![palier].push(f);
  }
  const sorties: { titre: string; detail: string }[] = [];
  for (const { haut, bas } of groupes.values()) {
    if (!haut.length || !bas.length) continue;
    const aire = (f: (typeof fiches)[number]) => (f.largeur! * f.profondeur!) / 1e6;
    const refHaut = Math.max(...haut.map(aire));
    for (const b of bas) {
      if (aire(b) > refHaut * SEUIL_INVERSION) {
        sorties.push({
          titre: b.titre,
          detail: `emprise au sol ${aire(b).toFixed(2)} m² contre ${refHaut.toFixed(2)} m² pour la ` +
            `version supérieure (${haut.map((h) => h.titre).join(", ")}) — cotes probablement inversées entre les deux fiches`,
        });
      }
    }
  }
  return sorties;
}

