import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AmbianceSettings, FloorTexture, WallFinish } from "./Viewer3DToolbar";

type Props = {
  ambiance: AmbianceSettings;
  onChange: (ambiance: AmbianceSettings) => void;
  onClose: () => void;
};

const FLOOR_OPTIONS: { id: FloorTexture; label: string; preview: string }[] = [
  { id: "default", label: "Défaut", preview: "" },
  { id: "carpet", label: "Moquette", preview: "/textures/floor_carpet_arcade.jpg" },
  { id: "epoxy", label: "Résine époxy", preview: "/textures/floor_epoxy.jpg" },
  { id: "concrete", label: "Béton ciré", preview: "/textures/floor_concrete.jpg" },
  { id: "parquet", label: "Parquet", preview: "/textures/floor_parquet.jpg" },
  { id: "vinyl", label: "Vinyle", preview: "/textures/floor_vinyl.jpg" },
  { id: "tile", label: "Carrelage", preview: "/textures/floor_tile.jpg" },
];

const WALL_OPTIONS: { id: WallFinish; label: string; preview: string }[] = [
  { id: "default", label: "Défaut", preview: "" },
  { id: "paint", label: "Peinture", preview: "" },
  { id: "brick", label: "Brique", preview: "/textures/wall_brick.jpg" },
  { id: "concrete", label: "Béton brut", preview: "/textures/wall_concrete.jpg" },
  { id: "wood", label: "Bois", preview: "/textures/wall_wood.jpg" },
];

const PAINT_COLORS = [
  "#f0f0f0", "#2d2d2d", "#1a1a2e", "#0f3460",
  "#533483", "#e94560", "#16213e", "#1b4332",
  "#7c3aed", "#dc2626", "#f59e0b", "#10b981",
];

export function AmbiancePanel({ ambiance, onChange, onClose }: Props) {
  return (
    <div className="absolute left-full top-0 ml-3 z-50 w-72 rounded-lg border border-border bg-card/95 backdrop-blur-md p-4 shadow-xl neon-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-sm font-bold text-foreground tracking-wide">
          Ambiance & Matériaux
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Floor textures */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Revêtement de sol
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {FLOOR_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={cn(
                "relative h-14 rounded-md border-2 overflow-hidden transition-all",
                ambiance.floorTexture === opt.id
                  ? "border-primary ring-1 ring-primary/50"
                  : "border-border/50 hover:border-border"
              )}
              onClick={() => onChange({ ...ambiance, floorTexture: opt.id })}
              title={opt.label}
            >
              {opt.preview ? (
                <img
                  src={opt.preview}
                  alt={opt.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground">{opt.label}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Wall finishes */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Finition des murs
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {WALL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={cn(
                "relative h-14 rounded-md border-2 overflow-hidden transition-all",
                ambiance.wallFinish === opt.id
                  ? "border-primary ring-1 ring-primary/50"
                  : "border-border/50 hover:border-border"
              )}
              onClick={() => onChange({ ...ambiance, wallFinish: opt.id })}
              title={opt.label}
            >
              {opt.preview ? (
                <img
                  src={opt.preview}
                  alt={opt.label}
                  className="w-full h-full object-cover"
                />
              ) : opt.id === "paint" ? (
                <div
                  className="w-full h-full"
                  style={{ backgroundColor: ambiance.wallColor }}
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground">{opt.label}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker for paint */}
      {ambiance.wallFinish === "paint" && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Couleur de peinture
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
                onClick={() => onChange({ ...ambiance, wallColor: color })}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={ambiance.wallColor}
              onChange={(e) => onChange({ ...ambiance, wallColor: e.target.value })}
              className="h-8 w-8 rounded cursor-pointer border-0 p-0"
            />
            <span className="text-xs text-muted-foreground font-mono">
              {ambiance.wallColor}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}