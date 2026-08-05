// Départements et régions à partir d'un code postal.
//
// Écrit une fois ici plutôt que recopié dans chaque fonction : l'annuaire arcade, la
// gazette et les imports de prospects ont tous besoin de la même conversion, et une
// divergence entre deux copies produirait des territoires incohérents d'un écran à
// l'autre.

const REGIONS: Record<string, string[]> = {
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Bretagne': ['22', '29', '35', '56'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Corse': ['2A', '2B', '20'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  "Provence-Alpes-Côte d'Azur": ['04', '05', '06', '13', '83', '84'],
  'Guadeloupe': ['971'],
  'Martinique': ['972'],
  'Guyane': ['973'],
  'La Réunion': ['974'],
  'Mayotte': ['976'],
};

const PAR_DEPARTEMENT = new Map<string, string>();
for (const [region, departements] of Object.entries(REGIONS)) {
  for (const d of departements) PAR_DEPARTEMENT.set(d, region);
}

/** Département d'un code postal. Corse et outre-mer ne suivent pas la règle des deux
 *  premiers chiffres : 20xxx couvre 2A et 2B, 97x tient sur trois caractères. */
export function departementDepuisCP(cp: string | null | undefined): string | null {
  const c = (cp ?? '').replace(/\D/g, '');
  if (c.length !== 5) return null;
  if (c.startsWith('97') || c.startsWith('98')) return c.slice(0, 3);
  // 20000-20190 → Corse-du-Sud, au-delà → Haute-Corse. Approximation admise : la
  // frontière réelle est communale, mais aucune décision commerciale n'en dépend.
  if (c.startsWith('20')) return Number(c) < 20200 ? '2A' : '2B';
  return c.slice(0, 2);
}

export function regionDepuisCP(cp: string | null | undefined): string | null {
  const d = departementDepuisCP(cp);
  return d ? (PAR_DEPARTEMENT.get(d) ?? null) : null;
}
