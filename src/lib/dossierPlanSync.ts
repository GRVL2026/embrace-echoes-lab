/**
 * Synchronisation JEUX ↔ DOSSIER.
 *
 * Le dossier (projects.selected_products) est un SUR-ENSEMBLE du plan :
 *  - il peut contenir des articles non plaçables (monétique, consommables,
 *    accessoires, pièces détachées…) qui ne doivent JAMAIS être touchés par le
 *    plan ;
 *  - il peut aussi contenir des jeux plaçables non encore placés — on ne les
 *    retire pas non plus.
 *
 * Le plan (projects.plan_data.placedEquipments) reflète le nombre réel
 * d'instances de chaque jeu positionnées dans la salle.
 */

export type CatalogRow = {
  id: string;               // catalog_products.id (uuid)
  shopify_id: string | null;
  name: string;
  category: string | null;
  price: number | null;
  price_monthly: number | null;
};

export type SelectedProduct = {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
};

export type PricingLine = { label: string; qty: number; amount: number };
export type Pricing = { lines: PricingLine[]; total_ht: number; monthly: number };

/** Catégories NON plaçables (accessoires, monétique, consommables, etc.). */
const NON_PLACEABLE = new Set<string>([
  "monetique",
  "merchandising",
  "consommables",
  "consommable",
  "pieces detachees",
  "piece detachee",
  "accessoires",
  "accessoire",
  "adresse",
]);

function normalize(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isPlaceableCategory(category: string | null | undefined): boolean {
  const c = normalize(category);
  if (!c) return true; // par défaut, on considère plaçable
  return !NON_PLACEABLE.has(c);
}

/** Calcule le prix unitaire d'un produit selon l'offre. */
export function unitPriceForOffer(row: CatalogRow, offer: string | null | undefined): number {
  if (offer === "location" || offer === "leasing") return Number(row.price_monthly ?? 0) || 0;
  return Number(row.price ?? 0) || 0;
}

/** Recalcule la ligne pricing (identique à la logique de DossierEdit). */
export function computePricing(products: SelectedProduct[], offer: string | null | undefined): Pricing {
  const lines: PricingLine[] = products.map((p) => ({
    label: p.name,
    qty: p.qty,
    amount: +(p.qty * p.unit_price).toFixed(2),
  }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const isRecurring = offer === "location" || offer === "leasing";
  return {
    lines,
    total_ht: isRecurring ? 0 : +total.toFixed(2),
    monthly: isRecurring ? +total.toFixed(2) : 0,
  };
}

/**
 * À l'OUVERTURE du planner : quantités initiales à pré-charger dans la sélection
 * du catalogue. Clé = shopify_id (= GameEquipment.id côté planner).
 */
export function buildInitialQuantities(
  selected: SelectedProduct[] | null | undefined,
  catalogRows: CatalogRow[],
): Map<string, number> {
  const byId = new Map<string, CatalogRow>();
  for (const r of catalogRows) byId.set(r.id, r);
  const out = new Map<string, number>();
  for (const p of selected ?? []) {
    const row = byId.get(p.product_id);
    if (!row) continue;
    if (!row.shopify_id) continue;
    if (!isPlaceableCategory(row.category)) continue;
    const qty = Math.max(1, Number(p.qty) || 1);
    out.set(row.shopify_id, (out.get(row.shopify_id) ?? 0) + qty);
  }
  return out;
}

/**
 * À l'ENREGISTREMENT du plan : synchronise selected_products avec le plan.
 *
 *  - Les articles NON plaçables du dossier sont conservés tels quels.
 *  - Pour les JEUX PLAÇABLES, le PLAN fait foi : selected_products contient
 *    exactement les machines placées (qty = nb d'instances). Les jeux plaçables
 *    présents dans le dossier mais absents du plan sont RETIRÉS.
 *  - Prix unitaire repris du catalogue selon l'offre (sauf si la ligne existait
 *    déjà : on conserve alors le prix historique).
 */
export function mergeSelectedProductsFromPlan(
  current: SelectedProduct[] | null | undefined,
  placedEquipments: { equipmentId: string }[],
  catalogRows: CatalogRow[],
  offer: string | null | undefined,
): SelectedProduct[] {
  const byShopify = new Map<string, CatalogRow>();
  const byUuid = new Map<string, CatalogRow>();
  for (const r of catalogRows) {
    if (r.shopify_id) byShopify.set(r.shopify_id, r);
    byUuid.set(r.id, r);
  }

  // Compte des instances placées, par shopify_id
  const placedCounts = new Map<string, number>();
  for (const pe of placedEquipments ?? []) {
    if (!pe?.equipmentId) continue;
    placedCounts.set(pe.equipmentId, (placedCounts.get(pe.equipmentId) ?? 0) + 1);
  }

  // Lignes plaçables issues du plan (product_id = catalog_products.id)
  const placedByProductId = new Map<string, SelectedProduct>();
  for (const [shopifyId, count] of placedCounts) {
    const row = byShopify.get(shopifyId);
    if (!row) continue;
    if (!isPlaceableCategory(row.category)) continue;
    placedByProductId.set(row.id, {
      product_id: row.id,
      name: row.name,
      qty: count,
      unit_price: unitPriceForOffer(row, offer),
    });
  }

  const result: SelectedProduct[] = [];
  const seen = new Set<string>();

  // 1. Parcours du dossier existant, en préservant l'ordre.
  for (const p of current ?? []) {
    const row = byUuid.get(p.product_id);
    const placeable = row ? isPlaceableCategory(row.category) : true;

    if (!placeable) {
      // Non plaçable : on n'y touche jamais.
      result.push({ ...p });
      seen.add(p.product_id);
      continue;
    }

    // Plaçable : le plan fait foi.
    const placed = placedByProductId.get(p.product_id);
    if (placed) {
      // Encore dans le plan → maj qty, prix historique conservé.
      result.push({ ...p, qty: placed.qty });
      seen.add(p.product_id);
    }
    // Sinon : retiré du plan → exclu du dossier.
  }

  // 2. Nouveaux jeux placés absents du dossier → append.
  for (const [pid, prod] of placedByProductId) {
    if (!seen.has(pid)) result.push(prod);
  }

  return result;
}
