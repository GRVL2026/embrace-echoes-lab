import { useCallback } from "react";
import type { CopilotAction, AddAssetAction } from "@/types/copilot";
import type { AmbianceSettings, LightingPreset, CeilingType } from "@/components/viewer3d/Viewer3DToolbar";
import type { PlacedEquipment } from "@/types/equipment";

type ActionExecutorProps = {
  currentAmbiance: AmbianceSettings;
  onAmbianceChange: (ambiance: AmbianceSettings) => void;
  onLightingChange: (preset: LightingPreset) => void;
  onAddEquipment: (equipment: PlacedEquipment) => void;
};

/**
 * Bridge between copilot AI actions and the 3D viewer settings.
 * Converts structured CopilotAction[] into actual state mutations.
 */
export function useCopilotActions({
  currentAmbiance,
  onAmbianceChange,
  onLightingChange,
  onAddEquipment,
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
            const placed: PlacedEquipment = {
              id: crypto.randomUUID(),
              equipmentId: assetAction.asset_id,
              name: assetAction.asset_name,
              width: 100,
              depth: 100,
              height: 150,
              safetyZone: 10,
              color: "hsl(263, 85%, 68%)",
              rotation: assetAction.rotation?.[1] ?? 0,
              position: {
                x: assetAction.position?.[0] ?? 300 + Math.random() * 200,
                y: assetAction.position?.[2] ?? 300 + Math.random() * 200,
              },
              model3d: assetAction.glb_url,
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
    [currentAmbiance, onAmbianceChange, onLightingChange, onAddEquipment]
  );

  return { executeActions };
}
