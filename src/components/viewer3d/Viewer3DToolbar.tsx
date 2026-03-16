import { useState } from "react";
import {
  Eye,
  EyeOff,
  Camera,
  ArrowUp,
  Square,
  Cuboid,
  Sun,
  Moon,
  Lightbulb,
  Footprints,
  Box,
  Columns,
  DoorOpen,
  Grid3X3,
  Layers,
  Route,
  Ruler,
  Paintbrush,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AmbiancePanel } from "./AmbiancePanel";

export type PresetView = "perspective" | "top" | "front" | "side" | null;
export type LightingPreset = "daylight" | "arcade" | "showroom";

export type FloorTexture = "default" | "carpet" | "epoxy" | "concrete" | "parquet" | "vinyl" | "tile";
export type WallFinish = "default" | "paint" | "brick" | "concrete" | "wood";

export type AmbianceSettings = {
  floorTexture: FloorTexture;
  wallFinish: WallFinish;
  wallColor: string; // hex color for paint finish
};

export type Viewer3DVisibility = {
  walls: boolean;
  floor: boolean;
  equipment: boolean;
  doors: boolean;
  pillars: boolean;
  grid: boolean;
  circulation: boolean;
  heights: boolean;
};

export type Viewer3DSettings = {
  presetView: PresetView;
  firstPerson: boolean;
  visibility: Viewer3DVisibility;
  lighting: LightingPreset;
  ambiance: AmbianceSettings;
};

export const DEFAULT_3D_SETTINGS: Viewer3DSettings = {
  presetView: null,
  firstPerson: false,
  visibility: {
    walls: true,
    floor: true,
    equipment: true,
    doors: true,
    pillars: true,
    grid: true,
    circulation: true,
    heights: false,
  },
  lighting: "daylight",
  ambiance: {
    floorTexture: "default",
    wallFinish: "default",
    wallColor: "#f0f0f0",
  },
};

type Props = {
  settings: Viewer3DSettings;
  onChange: (settings: Viewer3DSettings) => void;
};

const presetViews: { id: PresetView; label: string; icon: React.ElementType; shortcut: string }[] = [
  { id: "perspective", label: "Perspective", icon: Cuboid, shortcut: "1" },
  { id: "top", label: "Vue dessus", icon: ArrowUp, shortcut: "2" },
  { id: "front", label: "Vue face", icon: Square, shortcut: "3" },
  { id: "side", label: "Vue côté", icon: Layers, shortcut: "4" },
];

const lightingPresets: { id: LightingPreset; label: string; icon: React.ElementType }[] = [
  { id: "daylight", label: "Lumière du jour", icon: Sun },
  { id: "arcade", label: "Ambiance arcade", icon: Moon },
  { id: "showroom", label: "Showroom", icon: Lightbulb },
];

type VisKey = keyof Viewer3DVisibility;
const visibilityToggles: { key: VisKey; label: string; icon: React.ElementType }[] = [
  { key: "walls", label: "Murs", icon: Square },
  { key: "floor", label: "Sol", icon: Layers },
  { key: "equipment", label: "Équipements", icon: Box },
  { key: "doors", label: "Portes", icon: DoorOpen },
  { key: "pillars", label: "Poteaux", icon: Columns },
  { key: "grid", label: "Grille", icon: Grid3X3 },
  { key: "circulation", label: "Circulation", icon: Route },
  { key: "heights", label: "Hauteurs", icon: Ruler },
];

const DEFAULT_AMBIANCE: AmbianceSettings = { floorTexture: "default", wallFinish: "default", wallColor: "#f0f0f0" };

export function Viewer3DToolbar({ settings, onChange }: Props) {
  const [visExpanded, setVisExpanded] = useState(false);
  const [ambianceOpen, setAmbianceOpen] = useState(false);
  const ambiance = settings.ambiance ?? DEFAULT_AMBIANCE;

  const setPreset = (view: PresetView) => {
    onChange({ ...settings, presetView: view });
  };

  const toggleFirstPerson = () => {
    onChange({ ...settings, firstPerson: !settings.firstPerson });
  };

  const toggleVisibility = (key: VisKey) => {
    onChange({
      ...settings,
      visibility: { ...settings.visibility, [key]: !settings.visibility[key] },
    });
  };

  const setLighting = (preset: LightingPreset) => {
    onChange({ ...settings, lighting: preset });
  };

  const setAmbiance = (ambiance: AmbianceSettings) => {
    onChange({ ...settings, ambiance });
  };

  return (
    <div className="relative flex flex-col items-center gap-1 rounded-lg border border-border bg-card/80 backdrop-blur-sm p-2 neon-border">
      {/* Preset views */}
      {presetViews.map((view) => (
        <Tooltip key={view.id} delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-10 w-10 transition-all",
                settings.presetView === view.id && "bg-primary/20 text-primary glow-purple"
              )}
              onClick={() => setPreset(view.id)}
            >
              <view.icon className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>
              {view.label}{" "}
              <kbd className="ml-1 text-xs text-muted-foreground">{view.shortcut}</kbd>
            </p>
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator className="my-1 w-6" />

      {/* First person */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10 transition-all",
              settings.firstPerson && "bg-secondary/20 text-secondary glow-green"
            )}
            onClick={toggleFirstPerson}
          >
            <Footprints className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>
            Première personne{" "}
            <kbd className="ml-1 text-xs text-muted-foreground">F</kbd>
          </p>
        </TooltipContent>
      </Tooltip>

      <Separator className="my-1 w-6" />

      {/* Visibility toggles */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10", visExpanded && "bg-accent/20 text-accent")}
            onClick={() => setVisExpanded(!visExpanded)}
          >
            {visExpanded ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Visibilité</TooltipContent>
      </Tooltip>

      {visExpanded &&
        visibilityToggles.map((toggle) => (
          <Tooltip key={toggle.key} delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 transition-all",
                  settings.visibility[toggle.key]
                    ? "bg-accent/20 text-accent"
                    : "text-muted-foreground opacity-50"
                )}
                onClick={() => toggleVisibility(toggle.key)}
              >
                <toggle.icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{toggle.label}</TooltipContent>
          </Tooltip>
        ))}

      <Separator className="my-1 w-6" />

      {/* Lighting presets */}
      {lightingPresets.map((preset) => (
        <Tooltip key={preset.id} delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-10 w-10 transition-all",
                settings.lighting === preset.id && "bg-primary/20 text-primary glow-purple"
              )}
              onClick={() => setLighting(preset.id)}
            >
              <preset.icon className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{preset.label}</TooltipContent>
        </Tooltip>
      ))}

      <Separator className="my-1 w-6" />

      {/* Ambiance */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10 transition-all",
              ambianceOpen && "bg-primary/20 text-primary glow-purple"
            )}
            onClick={() => setAmbianceOpen(!ambianceOpen)}
          >
            <Paintbrush className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Ambiance & Matériaux</TooltipContent>
      </Tooltip>

      {/* Screenshot */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-10 w-10">
            <Camera className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Capturer la vue</TooltipContent>
      </Tooltip>

      {/* Ambiance floating panel */}
      {ambianceOpen && (
        <AmbiancePanel
          ambiance={settings.ambiance}
          onChange={setAmbiance}
          onClose={() => setAmbianceOpen(false)}
        />
      )}
    </div>
  );
}
