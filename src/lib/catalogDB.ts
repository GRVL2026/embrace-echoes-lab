import { supabase } from "@/integrations/supabase/client";
import type { GameEquipment } from "@/types/equipment";

/** Map DB row → GameEquipment */
function rowToEquipment(row: any): GameEquipment {
  return {
    id: row.shopify_id || row.id,
    name: row.name,
    category: row.category || "",
    width: Number(row.width) || 0,
    depth: Number(row.depth) || 0,
    height: Number(row.height) || 0,
    safetyZone: Number(row.safety_zone) || 10,
    color: row.color || undefined,
    icon: row.icon || undefined,
    pmrAccessible: row.pmr_accessible || false,
    centerPlacement: row.center_placement || false,
    playerClearance: row.player_clearance ? Number(row.player_clearance) : undefined,
    model3d: row.model3d || undefined,
    model3dRotation: row.model3d_rotation != null ? Number(row.model3d_rotation) : 0,
    description: row.description || undefined,
    vendor: row.vendor || undefined,
    price: row.price ? Number(row.price) : undefined,
    images: row.images || [],
    videoUrl: row.video_url || undefined,
    tags: row.tags || [],
    warranty: row.warranty || undefined,
    stock: row.stock || undefined,
    specs: row.specs || undefined,
  };
}

/** Map GameEquipment → DB row for upsert */
function equipmentToRow(eq: GameEquipment) {
  return {
    shopify_id: eq.id,
    name: eq.name,
    category: eq.category || "",
    width: eq.width,
    depth: eq.depth,
    height: eq.height,
    safety_zone: eq.safetyZone || 10,
    color: eq.color || null,
    icon: eq.icon || null,
    pmr_accessible: eq.pmrAccessible || false,
    center_placement: eq.centerPlacement || false,
    player_clearance: eq.playerClearance || null,
    model3d: eq.model3d || null,
    model3d_rotation: eq.model3dRotation ?? 0,
    description: eq.description || null,
    vendor: eq.vendor || null,
    price: eq.price || null,
    images: eq.images || [],
    video_url: eq.videoUrl || null,
    tags: eq.tags || [],
    warranty: eq.warranty || null,
    stock: eq.stock || null,
    specs: eq.specs || {},
    active: true,
    updated_at: new Date().toISOString(),
  };
}

/** Load all active catalog products from the database */
export async function loadCatalogFromDB(): Promise<GameEquipment[]> {
  const { data, error } = await supabase
    .from("catalog_products" as any)
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) {
    console.error("[Catalog DB] Failed to load:", error.message);
    return [];
  }

  return ((data as any[]) || []).map(rowToEquipment);
}

/** Sync Shopify products into the database.
 *  - New products are inserted
 *  - Existing products are updated (preserving model3d if not provided by Shopify)
 *  - Products no longer in Shopify are marked inactive
 *  Returns the updated full catalog.
 */
export async function syncShopifyToDB(shopifyProducts: GameEquipment[]): Promise<GameEquipment[]> {
  // Get existing products from DB to preserve model3d
  const { data: existing } = await supabase
    .from("catalog_products" as any)
    .select("shopify_id, model3d");

  const existingMap = new Map<string, string>();
  for (const row of (existing as any[]) || []) {
    if (row.model3d) existingMap.set(row.shopify_id, row.model3d);
  }

  // Upsert all Shopify products
  const rows = shopifyProducts.map(eq => {
    const row = equipmentToRow(eq);
    // Preserve existing model3d if Shopify doesn't provide one
    if (!row.model3d && existingMap.has(eq.id)) {
      row.model3d = existingMap.get(eq.id)!;
    }
    return row;
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("catalog_products" as any)
      .upsert(rows as any, { onConflict: "shopify_id" });

    if (error) {
      console.error("[Catalog DB] Upsert failed:", error.message);
      throw new Error("Erreur de synchronisation avec la base de données");
    }
  }

  // Mark products not in Shopify as inactive
  const shopifyIds = shopifyProducts.map(p => p.id);
  if (shopifyIds.length > 0) {
    const { error } = await supabase
      .from("catalog_products" as any)
      .update({ active: false, updated_at: new Date().toISOString() } as any)
      .eq("active", true)
      .not("shopify_id", "in", `(${shopifyIds.map(id => `"${id}"`).join(",")})`);

    if (error) {
      console.warn("[Catalog DB] Failed to deactivate old products:", error.message);
    }
  }

  // Return full updated catalog
  return loadCatalogFromDB();
}

/** Update a single field on a catalog product (e.g. model3d) */
export async function updateCatalogProduct(shopifyId: string, updates: Partial<Record<string, any>>) {
  const { error } = await supabase
    .from("catalog_products" as any)
    .update({ ...updates, updated_at: new Date().toISOString() } as any)
    .eq("shopify_id", shopifyId);

  if (error) {
    console.error("[Catalog DB] Update failed:", error.message);
  }
}
