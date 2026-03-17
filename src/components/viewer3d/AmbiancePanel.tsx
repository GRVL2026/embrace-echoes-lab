import { useState } from "react";
import { X, Sparkles, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { AmbianceSettings, FloorTexture, WallFinish, CeilingType, AmbianceTheme, PolyHavenTexture } from "./Viewer3DToolbar";
import { PolyHavenBrowser } from "./PolyHavenBrowser";

type SurfaceTarget = "floor" | "wall" | "ceiling";

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

const CEILING_OPTIONS: { id: CeilingType; label: string }[] = [
  { id: "none", label: "Aucun" },
  { id: "tiles", label: "Dalles" },
  { id: "beams", label: "Poutres" },
  { id: "black", label: "Noir" },
  { id: "technical", label: "Technique" },
];

type ThemePreset = {
  id: AmbianceTheme;
  label: string;
  description: string;
  colors: string[];
  settings: Omit<AmbianceSettings, "theme">;
};

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "retro80s",
    label: "Retro 80s",
    description: "Moquette, néon violet, plafond noir",
    colors: ["#7c3aed", "#ec4899", "#1a1a2e"],
    settings: {
      floorTexture: "carpet",
      wallFinish: "paint",
      wallColor: "#1a1a2e",
      wallHeight: 2.8,
      ceiling: "black",
      ceilingHeight: 2.8,
      fog: true,
      fogIntensity: 0.25,
    },
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    description: "Béton, néon bleu, brouillard intense",
    colors: ["#3b82f6", "#06b6d4", "#0f172a"],
    settings: {
      floorTexture: "epoxy",
      wallFinish: "concrete",
      wallColor: "#0f172a",
      wallHeight: 3.0,
      ceiling: "black",
      ceilingHeight: 3.0,
      fog: true,
      fogIntensity: 0.5,
    },
  },
  {
    id: "sportsbar",
    label: "Sports Bar",
    description: "Parquet, briques, poutres apparentes",
    colors: ["#dc2626", "#f59e0b", "#7c2d12"],
    settings: {
      floorTexture: "parquet",
      wallFinish: "brick",
      wallColor: "#f0f0f0",
      wallHeight: 3.2,
      ceiling: "beams",
      ceilingHeight: 3.2,
      fog: false,
      fogIntensity: 0,
    },
  },
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

export function AmbiancePanel({ ambiance: rawAmbiance, onChange, onClose }: Props) {
  const ambiance = ensureDefaults(rawAmbiance);
  const [polyhavenTarget, setPolyhavenTarget] = useState<SurfaceTarget | null>(null);

  const applyTheme = (preset: ThemePreset) => {
    onChange({ ...preset.settings, theme: preset.id, polyhavenFloor: null, polyhavenWall: null, polyhavenCeiling: null });
  };

  const update = (partial: Partial<AmbianceSettings>) => {
    onChange({ ...ambiance, ...partial, theme: "custom" });
  };

  const handlePolyHavenSelect = (target: SurfaceTarget, texture: PolyHavenTexture | null) => {
    if (target === "floor") {
      update({ polyhavenFloor: texture, floorTexture: texture ? "default" : ambiance.floorTexture });
    } else if (target === "wall") {
      update({ polyhavenWall: texture, wallFinish: texture ? "default" : ambiance.wallFinish });
    } else {
      update({ polyhavenCeiling: texture });
    }
  };

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

      {/* Theme presets */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> Thèmes
        </p>
        <div className="flex flex-col gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={cn(
                "flex items-center gap-2 rounded-md border-2 p-2 text-left transition-all",
                ambiance.theme === preset.id
                  ? "border-primary ring-1 ring-primary/50 bg-primary/10"
                  : "border-border/50 hover:border-border"
              )}
              onClick={() => applyTheme(preset)}
            >
              <div className="flex gap-0.5">
                {preset.colors.map((c, i) => (
                  <div key={i} className="h-6 w-3 rounded-sm" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground">{preset.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{preset.description}</p>
              </div>
            </button>
          ))}
        </div>
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
              onClick={() => update({ floorTexture: opt.id })}
              title={opt.label}
            >
              {opt.preview ? (
                <img src={opt.preview} alt={opt.label} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground">{opt.label}</span>
                </div>
              )}
            </button>
          ))}
        </div>
        {/* Poly Haven floor button */}
        <button
          className={cn(
            "mt-1.5 w-full flex items-center gap-1.5 rounded-md border-2 p-1.5 text-left transition-all",
            ambiance.polyhavenFloor
              ? "border-primary ring-1 ring-primary/50 bg-primary/5"
              : "border-dashed border-border/50 hover:border-border"
          )}
          onClick={() => setPolyhavenTarget("floor")}
        >
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
          {ambiance.polyhavenFloor ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <img src={ambiance.polyhavenFloor.thumbnail} alt="" className="h-6 w-6 rounded object-cover" />
              <span className="text-[10px] font-medium text-foreground truncate">{ambiance.polyhavenFloor.name}</span>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground">Parcourir Poly Haven…</span>
          )}
        </button>
      </div>
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
              onClick={() => update({ wallFinish: opt.id })}
              title={opt.label}
            >
              {opt.preview ? (
                <img src={opt.preview} alt={opt.label} className="w-full h-full object-cover" />
              ) : opt.id === "paint" ? (
                <div className="w-full h-full" style={{ backgroundColor: ambiance.wallColor }} />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground">{opt.label}</span>
                </div>
              )}
            </button>
          ))}
        </div>
        {/* Wall height slider */}
        <div className="mt-2">
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

      {/* Color picker for paint */}
      {ambiance.wallFinish === "paint" && (
        <div className="mb-4">
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

      {/* Ceiling */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Plafond
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {CEILING_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={cn(
                "h-10 rounded-md border-2 text-[10px] font-medium transition-all",
                ambiance.ceiling === opt.id
                  ? "border-primary ring-1 ring-primary/50 bg-primary/10 text-foreground"
                  : "border-border/50 hover:border-border text-muted-foreground"
              )}
              onClick={() => update({ ceiling: opt.id })}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* Ceiling height slider - shown when ceiling is not "none" */}
        {ambiance.ceiling !== "none" && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Hauteur</span>
              <span className="text-[10px] font-mono text-foreground">{ambiance.ceilingHeight.toFixed(1)} m</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">2.2</span>
              <Slider
                min={2.2}
                max={5}
                step={0.1}
                value={[ambiance.ceilingHeight]}
                onValueChange={([v]) => update({ ceilingHeight: v })}
                className="flex-1"
              />
              <span className="text-[10px] text-muted-foreground">5.0</span>
            </div>
          </div>
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
