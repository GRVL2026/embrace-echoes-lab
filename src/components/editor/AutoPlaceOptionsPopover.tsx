import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Play, ChevronDown } from "lucide-react";
import type { PlacementDensity, PlacementOptions } from "@/lib/placement";

type Props = {
  onLaunch: (opts: PlacementOptions) => void;
  label?: string;
  disabled?: boolean;
  defaultPreserveExisting?: boolean;
};

const DENSITY_LABELS: { value: PlacementDensity; label: string; sub: string }[] = [
  { value: "confort",  label: "Confort",  sub: "écarts généreux" },
  { value: "standard", label: "Standard", sub: "équilibré" },
  { value: "max",      label: "Maximum",  sub: "densité max" },
];

export function AutoPlaceOptionsPopover({ onLaunch, label = "Placer", disabled, defaultPreserveExisting = false }: Props) {
  const [open, setOpen] = useState(false);
  const [density, setDensity] = useState<PlacementDensity>("standard");
  const [groupByFamily, setGroupByFamily] = useState(true);
  const [preserveExisting, setPreserveExisting] = useState(defaultPreserveExisting);

  const launch = () => {
    setOpen(false);
    onLaunch({ density, groupByFamily, preserveExisting });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={disabled}>
          <Play className="h-3 w-3" />
          {label}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 bg-card border-border p-3 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Densité
          </Label>
          <div className="grid grid-cols-3 gap-1">
            {DENSITY_LABELS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDensity(d.value)}
                className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                  density === d.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-foreground hover:bg-muted/60"
                }`}
              >
                <div className="text-xs font-medium">{d.label}</div>
                <div className="text-[10px] opacity-70">{d.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 py-1">
          <div className="min-w-0">
            <Label htmlFor="ap-group" className="text-xs font-medium text-foreground">
              Grouper par famille
            </Label>
            <div className="text-[10px] text-muted-foreground">Flippers, simulateurs, grues…</div>
          </div>
          <Switch id="ap-group" checked={groupByFamily} onCheckedChange={setGroupByFamily} />
        </div>

        <div className="flex items-center justify-between gap-2 py-1">
          <div className="min-w-0">
            <Label htmlFor="ap-preserve" className="text-xs font-medium text-foreground">
              Préserver les jeux placés
            </Label>
            <div className="text-[10px] text-muted-foreground">Ne pas déplacer l'existant</div>
          </div>
          <Switch id="ap-preserve" checked={preserveExisting} onCheckedChange={setPreserveExisting} />
        </div>

        <Button className="w-full gap-2" size="sm" onClick={launch}>
          <Play className="h-3 w-3" />
          Lancer le placement
        </Button>
      </PopoverContent>
    </Popover>
  );
}
