// Rapprocher un établissement relevé dehors avec ceux que nous connaissons déjà.
//
// La règle qui gouverne tout : la GÉOGRAPHIE prime sur le nom. Cegid porte la raison
// sociale (« SARL LOISIRS 55 ») là où une source publique porte l'enseigne (« 10.55 ») ;
// comparer les noms seuls ne rapprochait que 5 % des lieux. Deux établissements à moins
// de cent mètres sont presque toujours le même.
//
// Mais l'inverse n'est pas vrai : une adresse exacte n'autorise PAS n'importe quel nom.
// « Magic Games » et « Games Over » à treize mètres restent deux enseignes. Distance et
// nom doivent se corroborer.
//
// Ces fonctions sont pures et sans état : elles ne touchent ni au réseau ni à la base.

export const D_MAX = 600;      // au-delà, ce n'est plus le même établissement
export const D_PROCHE = 150;
export const SIM_APPUI = 0.35; // le nom appuie une adresse déjà proche
export const SIM_DOUTE = 0.30;

const sansAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Forme comparable d'un nom. Les fiches clients portent un suffixe de commune —
 *  « L'OUSTALET — CHATEL » : il désigne le lieu, pas l'établissement, et faisait chuter
 *  la similarité au point de rétrograder de vrais rapprochements à quelques mètres. */
export function cle(s: string | null | undefined): string {
  const sansCommune = (s ?? '').split(/\s+[—–]\s+/)[0];
  return sansAccent(sansCommune.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
}

// Le type d'établissement et les articles ne distinguent rien : « Camping Le Ranch des
// Volcans » et « LE RANCH DES VOLCANS » désignent le même lieu, mais le mot « camping »
// à lui seul faisait chuter la similarité de 90 % à 67 % — assez pour rater le
// rapprochement. On compare ce qui identifie, pas ce qui catégorise.
const MOTS_VIDES = new Set([
  'camping', 'bowling', 'hotel', 'restaurant', 'bar', 'laser', 'game', 'games',
  'club', 'parc', 'park', 'centre', 'complexe', 'salle', 'village', 'vacances',
  'domaine', 'residence', 'sarl', 'sas', 'sasu', 'sa', 'eurl', 'scea', 'ste', 'societe',
  'le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'aux', 'au', 'a',
]);

export function cleIdentifiante(s: string | null | undefined): string {
  const mots = cle(s).split(' ').filter((m) => m && !MOTS_VIDES.has(m));
  // Si tout a été retiré — « Le Camping » — on retombe sur le nom complet plutôt que
  // de comparer deux chaînes vides, qui se ressembleraient parfaitement.
  return mots.length ? mots.join(' ') : cle(s);
}

/** Similarité par trigrammes, même principe que pg_trgm : proportion de trigrammes
 *  communs. Recalculée ici parce que le rapprochement se fait en mémoire. */
export function similarite(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tri = (s: string) => {
    const p = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = tri(a), B = tri(b);
  let communs = 0;
  for (const t of A) if (B.has(t)) communs++;
  return communs / (A.size + B.size - communs);
}

/** Distance approchée en mètres. La projection plate suffit largement à l'échelle
 *  d'une commune, et évite une extension géographique pour trois décimales. */
export function metres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat1 - lat2) * 111_320;
  const dLng = (lng1 - lng2) * 111_320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export type Cible = {
  id: string; nom: string; cle: string; cleBrute: string;
  lat: number | null; lng: number | null; cp: string | null;
};

/** Similarité de deux établissements. On compare à la fois les noms ENTIERS et les noms
 *  réduits à ce qui identifie ; le second rattrape « Camping Le Ranch des Volcans »
 *  contre « LE RANCH DES VOLCANS », le premier empêche « Magic Games » de se confondre
 *  avec « Magic Parc » au prétexte qu'il reste « magic » des deux côtés.
 *
 *  Un nom réduit à un seul mot ne suffit jamais à conclure seul : il faut alors que les
 *  noms entiers se ressemblent aussi. */
export function accord(a: { cle: string; cleBrute: string }, b: { cle: string; cleBrute: string }) {
  const ident = similarite(a.cle, b.cle);
  const entier = similarite(a.cleBrute, b.cleBrute);
  const substantiel = a.cle.includes(' ') && b.cle.includes(' ');
  return { valeur: Math.max(ident, entier), franc: ident >= 0.5 && (substantiel || entier >= 0.5) };
}

/** Index par centième de degré : trouver le voisin le plus proche sans parcourir dix
 *  mille lignes pour chaque établissement à rapprocher. */
export function indexer(cibles: Cible[]): Map<string, Cible[]> {
  const grille = new Map<string, Cible[]>();
  for (const c of cibles) {
    if (c.lat === null || c.lng === null) continue;
    const k = `${Math.round(c.lat * 100)}:${Math.round(c.lng * 100)}`;
    const l = grille.get(k);
    if (l) l.push(c); else grille.set(k, [c]);
  }
  return grille;
}

export function voisins(grille: Map<string, Cible[]>, lat: number, lng: number): Cible[] {
  const out: Cible[] = [];
  const li = Math.round(lat * 100), gi = Math.round(lng * 100);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const c = grille.get(`${li + a}:${gi + b}`);
      if (c) out.push(...c);
    }
  }
  return out;
}

export function indexerParCp(cibles: Cible[]): Map<string, Cible[]> {
  const parCp = new Map<string, Cible[]>();
  for (const c of cibles) {
    if (!c.cp) continue;
    const l = parCp.get(c.cp);
    if (l) l.push(c); else parCp.set(c.cp, [c]);
  }
  return parCp;
}

export type Verdict =
  | { cible: Cible; niveau: 'sur' | 'doute'; motif: string; score: number }
  | null;

/** Distance en deçà de laquelle deux fiches désignent le même bâtiment : le nom n'a
 *  alors plus à concorder pour qu'un œil humain vaille la peine d'être sollicité. Un
 *  établissement change d'enseigne sans changer d'adresse. */
const D_MEME_ADRESSE = 50;

export function rapprocher(
  lieu: { nom: string | null; cle: string; cleBrute: string; lat: number | null; lng: number | null; cp: string | null },
  grille: Map<string, Cible[]>,
  parCp: Map<string, Cible[]>,
  // Similarité de nom minimale pour retenir un voisin géographique. Zéro par défaut :
  // c'est le comportement d'origine, calibré sur des salles isolées, où deux
  // établissements proches sont presque toujours le même.
  //
  // EN MILIEU DENSE IL FAUT L'ÉLEVER. Six cents mètres, dans un centre-ville, ce sont
  // des centaines de commerces : la proximité seule n'apprend plus rien, et laisser le
  // seuil à zéro produit des rapprochements comme « Bar Latino Metz » avec un camping
  // à 187 m — du bruit qui noie les vrais sous des dizaines d'arbitrages inutiles.
  simMin = 0,
): Verdict {
  let meilleur: Verdict = null;

  // La géographie d'abord : elle ne dépend d'aucune convention de nommage.
  if (lieu.lat !== null && lieu.lng !== null) {
    for (const c of voisins(grille, lieu.lat, lieu.lng)) {
      const d = metres(lieu.lat, lieu.lng, c.lat!, c.lng!);
      if (d > D_MAX) continue;
      const { valeur: sim, franc } = accord(lieu, c);
      // Même adresse : on garde quoi qu'il arrive. Sinon le nom doit dire quelque chose.
      if (d > D_MEME_ADRESSE && sim < simMin) continue;
      const niveau: 'sur' | 'doute' =
        (franc && d <= D_MAX) || (franc && sim >= SIM_APPUI && d <= D_PROCHE) ? 'sur' : 'doute';
      const score = sim * 600 + Math.max(0, 600 - d);
      if (!meilleur || score > meilleur.score) {
        meilleur = { cible: c, niveau, motif: `${Math.round(d)} m, nom ${Math.round(sim * 100)} %`, score };
      }
    }
  }
  if (meilleur?.niveau === 'sur') return meilleur;

  // À défaut, le code postal et le nom.
  if (lieu.cp) {
    for (const c of parCp.get(lieu.cp) ?? []) {
      const { valeur: sim, franc } = accord(lieu, c);
      if (sim < SIM_DOUTE) continue;
      const niveau: 'sur' | 'doute' = franc && sim >= 0.65 ? 'sur' : 'doute';
      const score = sim * 1000;
      if (!meilleur || (niveau === 'sur' && meilleur.niveau === 'doute') || score > meilleur.score) {
        meilleur = { cible: c, niveau, motif: `même code postal, nom ${Math.round(sim * 100)} %`, score };
      }
    }
  }
  return meilleur;
}

/** Lecture complète d'une table : PostgREST plafonne chaque requête à mille lignes,
 *  quelle que soit la limite demandée. Sans pagination, un rapprochement portant sur
 *  huit mille prospects n'en verrait que le premier millier — silencieusement. */
export async function toutLire(
  admin: any, table: string, colonnes: string, filtre?: (q: any) => any,
): Promise<any[]> {
  const acc: any[] = [];
  for (let de = 0; ; de += 1000) {
    let q = admin.from(table).select(colonnes).range(de, de + 999);
    if (filtre) q = filtre(q);
    const { data, error } = await q;
    if (error) throw error;
    acc.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return acc;
}
