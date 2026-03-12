import { supabase } from "@/integrations/supabase/client";

/** Load all equipment→model3d mappings from the database */
export async function loadModelMappings(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("equipment_models" as any)
    .select("equipment_id, model_url");
  if (error) {
    console.warn("[3D] Failed to load model mappings:", error.message);
    return {};
  }
  const map: Record<string, string> = {};
  for (const row of (data as any[]) || []) {
    map[row.equipment_id] = row.model_url;
  }
  return map;
}

/** Save or update an equipment→model3d mapping */
export async function saveModelMapping(equipmentId: string, modelUrl: string) {
  const { error } = await supabase
    .from("equipment_models" as any)
    .upsert(
      { equipment_id: equipmentId, model_url: modelUrl } as any,
      { onConflict: "equipment_id" }
    );
  if (error) console.error("[3D] Failed to save model mapping:", error.message);
}

/** Remove an equipment→model3d mapping */
export async function deleteModelMapping(equipmentId: string) {
  const { error } = await supabase
    .from("equipment_models" as any)
    .delete()
    .eq("equipment_id", equipmentId);
  if (error) console.error("[3D] Failed to delete model mapping:", error.message);
}
