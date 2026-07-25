// Sélection de produits catalogue pertinents pour une accroche de prospection.
// Utilisé par generer-accroche-prospect ET preparer-prospects-agent
// pour garantir une qualité d'accroche identique.

export const SEGMENT_CATEGORIES: Record<string, string[]> = {
  loisirs: [
    'Flippers',
    'Jeux de conduite',
    'Sport',
    'Tir',
    'Réalité virtuelle',
    'Jeux famille',
    'Adresse',
    'Grues & distributeurs',
  ],
  chr: [
    'Jeux de café',
    'Flippers',
    'Grues & distributeurs',
    'Adresse',
    'Sport',
  ],
  retail: [
    'Grues & distributeurs',
    'Monétique',
  ],
};

// Catégories toujours exclues en prospection.
const EXCLUDED = ['Consommables', 'Pièces détachées'];

export interface CatalogSuggestion {
  name: string;
  category: string;
  description?: string | null;
  price_monthly?: number | null;
}

export function categoriesForSegment(segment: string | null | undefined): string[] {
  const s = String(segment ?? '').toLowerCase();
  return SEGMENT_CATEGORIES[s] ?? [];
}

/** Récupère 2-4 produits représentatifs pour le segment, hors catégories exclues. */
export async function fetchCatalogSuggestions(
  admin: any,
  segment: string | null | undefined,
  limit = 4,
): Promise<CatalogSuggestion[]> {
  const cats = categoriesForSegment(segment);
  if (cats.length === 0) return [];

  // Variantes de casse (ex: "Grues & Distributeurs" vs "Grues & distributeurs")
  const variants = Array.from(new Set(
    cats.flatMap((c) => [c, c.toLowerCase(), c.replace(/\bd/g, 'D')]),
  ));

  const { data, error } = await admin
    .from('catalog_products')
    .select('name, category, description, price_monthly, price')
    .not('active', 'is', false)
    .in('category', variants)
    .limit(60);

  if (error || !Array.isArray(data)) return [];

  const filtered = (data as any[]).filter(
    (r) => r?.name && !EXCLUDED.includes(r.category),
  );

  // Groupe par catégorie normalisée, prend 1 produit par catégorie en priorité
  // pour diversifier, puis complète.
  const byCat = new Map<string, any[]>();
  for (const r of filtered) {
    const key = String(r.category ?? '').toLowerCase();
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(r);
  }

  const picked: any[] = [];
  const orderedCats = cats.map((c) => c.toLowerCase());
  // 1er tour : 1 par catégorie
  for (const c of orderedCats) {
    const arr = byCat.get(c);
    if (arr && arr.length && picked.length < limit) picked.push(arr.shift());
  }
  // 2e tour : complète
  for (const c of orderedCats) {
    const arr = byCat.get(c);
    while (arr && arr.length && picked.length < limit) picked.push(arr.shift());
  }

  return picked.slice(0, limit).map((r) => ({
    name: String(r.name),
    category: String(r.category ?? ''),
    description: r.description ?? null,
    price_monthly: r.price_monthly ?? null,
  }));
}

/** Rend une liste texte des produits à passer au prompt Claude. */
export function renderSuggestionsForPrompt(items: CatalogSuggestion[]): string {
  if (!items.length) return '';
  const lines = items.map((p) => {
    const desc = (p.description ?? '').toString().trim().replace(/\s+/g, ' ').slice(0, 140);
    const loyer = p.price_monthly ? ` — dépôt possible (~${Math.round(Number(p.price_monthly))} €/mois indicatif)` : '';
    return `- ${p.name} (${p.category})${desc ? ` : ${desc}` : ''}${loyer}`;
  });
  return lines.join('\n');
}
