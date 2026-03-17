import { useState } from "react";
import { X, Globe, Box, Trash2, RotateCw } from "lucide-react";
import { useEditor } from "@/contexts/EditorContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { AmbianceSettings, PolyHavenTexture } from "./Viewer3DToolbar";
import type { PlacedEquipment } from "@/types/equipment";
import { PolyHavenBrowser } from "./PolyHavenBrowser";
import { SketchfabBrowser } from "./SketchfabBrowser";

type SurfaceTarget = "floor" | "wall" | "ceiling";

type Props = {
  ambiance: AmbianceSettings;
  onChange: (ambiance: AmbianceSettings) => void;
  onClose: () => void;
  onAddEquipment?: (equipment: PlacedEquipment) => void;
};

const PAINT_COLORS = [
  "#f0f0f0", "#2d2d2d", "#1a1a2e", "#0f3460",
  "#533483", "#e94560", "#16213e", "#1b4332",
  "#7c3aed", "#dc2626", "#f59e0b", "#10b981",
];

const defaults: AmbianceSettings = {
  floorTexture: "default",
  wallFinish: "default",
  wallColor: "#f0f0f0",
  wallHeight: 2.8,
  ceiling: "none",
  ceilingHeight: 2.8,
  fog: false,
  fogIntensity: 0.3,
  theme: "custom",
  polyhavenFloor: null,
  polyhavenWall: null,
  polyhavenCeiling: null,
};

function ensureDefaults(a: Partial<AmbianceSettings> | undefined): AmbianceSettings {
  return { ...defaults, ...a };
}

export function AmbiancePanel({ ambiance: rawAmbiance, onChange, onClose, onAddEquipment }: Props) {
  const { state, dispatch } = useEditor();
  const ambiance = ensureDefaults(rawAmbiance);
  const [polyhavenTarget, setPolyhavenTarget] = useState<SurfaceTarget | null>(null);
  const [sketchfabOpen, setSketchfabOpen] = useState(false);

  const update = (partial: Partial<AmbianceSettings>) => {
    onChange({ ...ambiance, ...partial, theme: "custom" });
  };

  const handlePolyHavenSelect = (target: SurfaceTarget, texture: PolyHavenTexture | null) => {
    if (target === "floor") {
      update({ polyhavenFloor: texture, floorTexture: "default" });
    } else if (target === "wall") {
      update({ polyhavenWall: texture, wallFinish: "default" });
    } else {
      update({ polyhavenCeiling: texture });
    }
  };

  // When Poly Haven browser is open, show it instead of the main panel
  if (polyhavenTarget) {
    return (
      <div className="absolute left-full top-0 ml-3 z-50 w-72 max-h-[80vh] flex flex-col rounded-lg border border-border bg-card/95 backdrop-blur-md shadow-xl neon-border">
        <PolyHavenBrowser
          target={polyhavenTarget}
          currentTexture={
            polyhavenTarget === "floor" ? ambiance.polyhavenFloor :
            polyhavenTarget === "wall" ? ambiance.polyhavenWall :
            ambiance.polyhavenCeiling
          }
          onSelect={(tex) => handlePolyHavenSelect(polyhavenTarget, tex)}
          onClose={() => setPolyhavenTarget(null)}
        />
      </div>
    );
  }

  // When Sketchfab browser is open, show it instead of the main panel
  if (sketchfabOpen && onAddEquipment) {
    return (
      <div className="absolute left-full top-0 ml-3 z-50 w-80 max-h-[80vh] flex flex-col rounded-lg border border-border bg-card/95 backdrop-blur-md shadow-xl neon-border">
        <SketchfabBrowser
          onAddToScene={onAddEquipment}
          onClose={() => setSketchfabOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="absolute left-full top-0 ml-3 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card/95 backdrop-blur-md p-4 shadow-xl neon-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-sm font-bold text-foreground tracking-wide">
          Ambiance & Matériaux
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Assets 3D – Sketchfab only (non-catalog) */}
      {onAddEquipment && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Assets 3D
          </p>
          <button
            className="w-full flex items-center gap-2 rounded-md border-2 border-dashed border-border/50 hover:border-border p-2 text-left transition-all mb-2"
            onClick={() => setSketchfabOpen(true)}
          >
            <Box className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs text-muted-foreground">Chercher sur Sketchfab…</span>
          </button>

          {/* List of all assets in the scene */}
          {(() => {
            const assets = state.placedEquipments;
            if (assets.length === 0) return null;
            return (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground mb-1">
                  {assets.length} asset{assets.length > 1 ? "s" : ""} importé{assets.length > 1 ? "s" : ""}
                </p>
                <div className="max-h-40 overflow-y-auto space-y-0.5 pr-0.5">
                  {assets.map((eq) => (
                    <div
                      key={eq.id}
                      className="flex items-center gap-1.5 rounded-md border border-border/50 hover:border-border p-1.5 group transition-all"
                    >
                      <div
                        className="h-8 w-8 rounded shrink-0 flex items-center justify-center bg-muted"
                        style={{ backgroundColor: eq.color }}
                      >
                        <Box className="h-3.5 w-3.5 text-foreground/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-foreground truncate">{eq.name}</p>
                        <p className="text-[9px] text-muted-foreground">
                          {eq.width}×{eq.depth}{eq.height ? `×${eq.height}` : ""} cm
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive"
                        onClick={() => dispatch({ type: "DELETE_PLACED_EQUIPMENT", id: eq.id })}
                        title="Supprimer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Floor – Poly Haven only */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Revêtement de sol
        </p>
        <button
          className={cn(
            "w-full flex items-center gap-1.5 rounded-md border-2 p-2 text-left transition-all",
            ambiance.polyhavenFloor
              ? "border-primary ring-1 ring-primary/50 bg-primary/5"
              : "border-dashed border-border/50 hover:border-border"
          )}
          onClick={() => setPolyhavenTarget("floor")}
        >
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          {ambiance.polyhavenFloor ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <img src={ambiance.polyhavenFloor.thumbnail} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="text-xs font-medium text-foreground truncate">{ambiance.polyhavenFloor.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Parcourir Poly Haven…</span>
          )}
        </button>
        {ambiance.polyhavenFloor && (
          <button
            className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => update({ polyhavenFloor: null })}
          >
            ✕ Retirer la texture
          </button>
        )}
      </div>

      {/* Walls – Poly Haven + wall management */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Finition des murs
        </p>
        <button
          className={cn(
            "w-full flex items-center gap-1.5 rounded-md border-2 p-2 text-left transition-all",
            ambiance.polyhavenWall
              ? "border-primary ring-1 ring-primary/50 bg-primary/5"
              : "border-dashed border-border/50 hover:border-border"
          )}
          onClick={() => setPolyhavenTarget("wall")}
        >
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          {ambiance.polyhavenWall ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <img src={ambiance.polyhavenWall.thumbnail} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="text-xs font-medium text-foreground truncate">{ambiance.polyhavenWall.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Parcourir Poly Haven…</span>
          )}
        </button>
        {ambiance.polyhavenWall && (
          <button
            className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => update({ polyhavenWall: null })}
          >
            ✕ Retirer la texture
          </button>
        )}

        {/* Wall color (shown when no Poly Haven texture) */}
        {!ambiance.polyhavenWall && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Couleur des murs
            </p>
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {PAINT_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn(
                    "h-8 w-full rounded-md border-2 transition-all",
                    ambiance.wallColor === color
                      ? "border-primary ring-1 ring-primary/50 scale-110"
                      : "border-border/30 hover:border-border"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => update({ wallColor: color })}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={ambiance.wallColor}
                onChange={(e) => update({ wallColor: e.target.value })}
                className="h-8 w-8 rounded cursor-pointer border-0 p-0"
              />
              <span className="text-xs text-muted-foreground font-mono">{ambiance.wallColor}</span>
            </div>
          </div>
        )}

        {/* Wall height */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Hauteur des murs</span>
            <span className="text-[10px] font-mono text-foreground">{ambiance.wallHeight.toFixed(1)} m</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">2.2</span>
            <Slider
              min={2.2}
              max={5}
              step={0.1}
              value={[ambiance.wallHeight]}
              onValueChange={([v]) => update({ wallHeight: v })}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground">5.0</span>
          </div>
        </div>
      </div>

      {/* Ceiling – Poly Haven only */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Plafond
        </p>
        <button
          className={cn(
            "w-full flex items-center gap-1.5 rounded-md border-2 p-2 text-left transition-all",
            ambiance.polyhavenCeiling
              ? "border-primary ring-1 ring-primary/50 bg-primary/5"
              : "border-dashed border-border/50 hover:border-border"
          )}
          onClick={() => setPolyhavenTarget("ceiling")}
        >
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          {ambiance.polyhavenCeiling ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <img src={ambiance.polyhavenCeiling.thumbnail} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="text-xs font-medium text-foreground truncate">{ambiance.polyhavenCeiling.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Parcourir Poly Haven…</span>
          )}
        </button>
        {ambiance.polyhavenCeiling && (
          <button
            className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => update({ polyhavenCeiling: null })}
          >
            ✕ Retirer la texture
          </button>
        )}
      </div>

      {/* Fog */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Brouillard / Haze
          </p>
          <Switch
            checked={ambiance.fog}
            onCheckedChange={(checked) => update({ fog: checked })}
          />
        </div>
        {ambiance.fog && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Léger</span>
            <Slider
              min={0.05}
              max={0.8}
              step={0.05}
              value={[ambiance.fogIntensity]}
              onValueChange={([v]) => update({ fogIntensity: v })}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground">Dense</span>
          </div>
        )}
      </div>
    </div>
  );
}
