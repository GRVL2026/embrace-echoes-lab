import { useCallback } from "react";
import type { CopilotAction } from "@/types/copilot";
import type { AmbianceSettings, LightingPreset, CeilingType } from "@/components/viewer3d/Viewer3DToolbar";

type ActionExecutorProps = {
  currentAmbiance: AmbianceSettings;
  onAmbianceChange: (ambiance: AmbianceSettings) => void;
  onLightingChange: (preset: LightingPreset) => void;
};

/**
 * Bridge between copilot AI actions and the 3D viewer settings.
 * Converts structured CopilotAction[] into actual state mutations.
 */
export function useCopilotActions({
  currentAmbiance,
  onAmbianceChange,
  onLightingChange,
}: ActionExecutorProps) {
  const executeActions = useCallback(
    (actions: CopilotAction[]) => {
      let ambiance = { ...currentAmbiance, theme: "custom" as const };

      for (const action of actions) {
        switch (action.type) {
          case "apply_material": {
            // For now, we store the polyhaven ID — the 3D viewer resolves the texture URLs
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

          default:
            console.warn("Unknown copilot action:", action);
        }
      }

      onAmbianceChange(ambiance);
    },
    [currentAmbiance, onAmbianceChange, onLightingChange]
  );

  return { executeActions };
}
