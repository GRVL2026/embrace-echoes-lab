import { useCallback } from "react";
import type { CopilotAction, AddAssetAction, PlacementSurface } from "@/types/copilot";
import type { AmbianceSettings, LightingPreset, CeilingType } from "@/components/viewer3d/Viewer3DToolbar";
import type { PlacedEquipment } from "@/types/equipment";
import type { RoomContext } from "@/lib/copilotApi";

type ActionExecutorProps = {
  currentAmbiance: AmbianceSettings;
  onAmbianceChange: (ambiance: AmbianceSettings) => void;
  onLightingChange: (preset: LightingPreset) => void;
  onAddEquipment: (equipment: PlacedEquipment) => void;
  roomContext?: RoomContext;
};

/**
 * V2: Smart spatial placement — positions assets logically based on
 * their surface type (wall/floor/ceiling) and room geometry.
 */
function computePosition(
  action: AddAssetAction,
  roomCtx?: RoomContext,
): { x: number; y: number; rotation: number } {
  const surface: PlacementSurface = action.placement_surface || "floor";

  // If AI provided explicit positions, use them (x = width axis, z = depth axis mapped to 2D y)
  if (action.position) {
    return {
      x: action.position[0],
      y: action.position[2], // Z in 3D = Y in 2D plan
      rotation: action.rotation?.[1] ?? 0,
    };
  }

  if (!roomCtx) {
    // Fallback: random position
    return {
      x: 300 + Math.random() * 200,
      y: 300 + Math.random() * 200,
      rotation: action.rotation?.[1] ?? 0,
    };
  }

  const walls = roomCtx.walls || [];
  const doors = roomCtx.doors || [];
  const existing = roomCtx.existing_equipment || [];
  const minX = Math.min(...roomCtx.floor_points.map(p => p.x));
  const maxX = Math.max(...roomCtx.floor_points.map(p => p.x));
  const minY = Math.min(...roomCtx.floor_points.map(p => p.y));
  const maxY = Math.max(...roomCtx.floor_points.map(p => p.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  if (surface === "wall" && walls.length > 0) {
    // Pick the wall specified by wall_index, or find the longest free wall
    const wallIdx = action.wall_index ?? findBestWall(walls, doors, existing);
    const wall = walls[wallIdx] || walls[0];
    // Place at midpoint of the wall
    const t = 0.5;
    const x = wall.start.x + (wall.end.x - wall.start.x) * t;
    const y = wall.start.y + (wall.end.y - wall.start.y) * t;
    // Compute rotation to face inward (perpendicular to wall)
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    return { x, y, rotation: angle };
  }

  if (surface === "ceiling") {
    // Center of the room
    return { x: centerX, y: centerY, rotation: 0 };
  }

  // Floor placement: find a free corner or free zone
  const corners = roomCtx.floor_points.map(p => ({ x: p.x, y: p.y }));
  const margin = 80; // cm from walls

  // Try corners first, then free zones
  for (const corner of corners) {
    const cx = corner.x < centerX ? corner.x + margin : corner.x - margin;
    const cy = corner.y < centerY ? corner.y + margin : corner.y - margin;
    if (!hasCollision(cx, cy, 100, 100, existing, doors)) {
      return { x: cx, y: cy, rotation: 0 };
    }
  }

  // Try along walls with offset
  for (const wall of walls) {
    const mx = (wall.start.x + wall.end.x) / 2;
    const my = (wall.start.y + wall.end.y) / 2;
    // Offset inward
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / len * margin;
    const ny = dx / len * margin;
    // Try both sides, pick the one closer to center
    const p1 = { x: mx + nx, y: my + ny };
    const p2 = { x: mx - nx, y: my - ny };
    const d1 = Math.abs(p1.x - centerX) + Math.abs(p1.y - centerY);
    const d2 = Math.abs(p2.x - centerX) + Math.abs(p2.y - centerY);
    const p = d1 < d2 ? p1 : p2;
    if (!hasCollision(p.x, p.y, 100, 100, existing, doors)) {
      return { x: p.x, y: p.y, rotation: 0 };
    }
  }

  // Last resort: offset from center
  return {
    x: centerX + (Math.random() - 0.5) * 100,
    y: centerY + (Math.random() - 0.5) * 100,
    rotation: 0,
  };
}

function findBestWall(
  walls: RoomContext["walls"],
  doors: RoomContext["doors"],
  equipment: RoomContext["existing_equipment"],
): number {
  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    // Penalty for doors on this wall
    const mx = (w.start.x + w.end.x) / 2;
    const my = (w.start.y + w.end.y) / 2;
    let doorPenalty = 0;
    for (const d of doors) {
      const dist = Math.sqrt((d.position.x - mx) ** 2 + (d.position.y - my) ** 2);
      if (dist < len / 2 + d.width) doorPenalty += 500;
    }

    // Penalty for existing equipment near this wall
    let eqPenalty = 0;
    for (const e of equipment) {
      const dist = Math.sqrt((e.position.x - mx) ** 2 + (e.position.y - my) ** 2);
      if (dist < 200) eqPenalty += 100;
    }

    const score = len - doorPenalty - eqPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function hasCollision(
  x: number, y: number, w: number, d: number,
  equipment: RoomContext["existing_equipment"],
  doors: RoomContext["doors"],
): boolean {
  const margin = 50;
  for (const e of equipment) {
    if (
      Math.abs(x - e.position.x) < (w + e.width) / 2 + margin &&
      Math.abs(y - e.position.y) < (d + e.depth) / 2 + margin
    ) return true;
  }
  for (const door of doors) {
    const dist = Math.sqrt((x - door.position.x) ** 2 + (y - door.position.y) ** 2);
    if (dist < door.width + 150) return true;
  }
  return false;
}

/**
 * Bridge between copilot AI actions and the 3D viewer settings.
 * V2: Includes spatial placement intelligence.
 */
export function useCopilotActions({
  currentAmbiance,
  onAmbianceChange,
  onLightingChange,
  onAddEquipment,
  roomContext,
}: ActionExecutorProps) {
  const executeActions = useCallback(
    (actions: CopilotAction[]) => {
      let ambiance = { ...currentAmbiance, theme: "custom" as const };

      for (const action of actions) {
        switch (action.type) {
          case "apply_material": {
            const polyhavenTexture = {
              id: action.material_id,
              name: action.material_name || action.material_id,
              thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${action.material_id}.png?width=100`,
              urls: {
                diffuse: action.urls?.diffuse || null,
                normal: action.urls?.normal || null,
                roughness: action.urls?.roughness || null,
                ao: null,
              },
            };

            if (action.target === "floor") {
              ambiance = { ...ambiance, polyhavenFloor: polyhavenTexture, floorTexture: "default" };
            } else if (action.target === "wall") {
              ambiance = { ...ambiance, polyhavenWall: polyhavenTexture, wallFinish: "default" };
            } else if (action.target === "ceiling") {
              ambiance = { ...ambiance, polyhavenCeiling: polyhavenTexture };
            }
            break;
          }

          case "apply_lighting": {
            onLightingChange(action.preset as LightingPreset);
            break;
          }

          case "set_wall_color": {
            ambiance = { ...ambiance, wallColor: action.color, wallFinish: "paint" };
            break;
          }

          case "set_ceiling": {
            ambiance = { ...ambiance, ceiling: action.ceiling_type as CeilingType };
            break;
          }

          case "set_fog": {
            ambiance = {
              ...ambiance,
              fog: action.enabled,
              ...(action.density !== undefined && { fogIntensity: action.density }),
            };
            break;
          }

          case "add_asset": {
            const assetAction = action as AddAssetAction;
            const pos = computePosition(assetAction, roomContext);
            const placed: PlacedEquipment = {
              id: crypto.randomUUID(),
              equipmentId: assetAction.asset_id,
              name: assetAction.asset_name,
              width: 100,
              depth: 100,
              height: 150,
              safetyZone: 10,
              color: "hsl(263, 85%, 68%)",
              rotation: pos.rotation,
              position: { x: pos.x, y: pos.y },
              model3d: assetAction.glb_url,
              autoScale: true,
            };
            onAddEquipment(placed);
            break;
          }

          default:
            console.warn("Unknown copilot action:", action);
        }
      }

      onAmbianceChange(ambiance);
    },
    [currentAmbiance, onAmbianceChange, onLightingChange, onAddEquipment, roomContext]
  );

  return { executeActions };
}
