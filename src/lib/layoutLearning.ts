import { supabase } from "@/integrations/supabase/client";
import type { EditorState } from "@/types/editor";
import type { GameEquipment } from "@/types/equipment";

/**
 * Saves a layout snapshot when a project dossier is validated.
 * This data is used by the AI to learn placement patterns from manual adjustments.
 */
export async function saveLayoutSnapshot(
  state: EditorState,
  catalog: GameEquipment[],
  projectName: string,
) {
  try {
    const closedRooms = state.rooms.filter(r => r.isClosed);
    if (closedRooms.length === 0 || state.placedEquipments.length === 0) return;

    // Compute room area
    const room = closedRooms[0];
    const pts = room.points;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    const areaM2 = Math.abs(area) / 2 / 10000; // cm² to m²

    const roomGeometry = {
      rooms: state.rooms.map(r => ({ id: r.id, points: r.points, isClosed: r.isClosed })),
      doors: state.doors.map(d => ({ id: d.id, position: d.position, width: d.width, roomId: d.roomId, edgeIndex: d.edgeIndex })),
      pillars: state.pillars.map(p => ({ id: p.id, position: p.position, width: p.width, depth: p.depth, shape: p.shape })),
    };

    const equipmentPlacements = state.placedEquipments.map(pe => ({
      equipmentId: pe.equipmentId,
      name: pe.name,
      position: pe.position,
      rotation: pe.rotation,
      width: pe.width,
      depth: pe.depth,
      height: pe.height,
      centerPlacement: pe.centerPlacement,
    }));

    const catalogUsed = state.placedEquipments
      .map(pe => catalog.find(c => c.id === pe.equipmentId))
      .filter(Boolean)
      .map(c => ({ id: c!.id, name: c!.name, category: c!.category, width: c!.width, depth: c!.depth }));

    // Deduplicate catalog
    const seenCat = new Set<string>();
    const uniqueCatalog = catalogUsed.filter(c => {
      if (seenCat.has(c.id)) return false;
      seenCat.add(c.id);
      return true;
    });

    await supabase.from("layout_snapshots").insert({
      project_name: projectName,
      room_geometry: roomGeometry,
      equipment_placements: equipmentPlacements,
      catalog_used: uniqueCatalog,
      manual_adjustments: true, // assume manual since user validated
      room_area_m2: Math.round(areaM2 * 100) / 100,
      equipment_count: state.placedEquipments.length,
    });

    console.log("[layout-learning] Snapshot saved for AI learning");
  } catch (err) {
    console.warn("[layout-learning] Failed to save snapshot:", err);
  }
}
