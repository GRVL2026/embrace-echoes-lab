import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FileDown, Loader2 } from "lucide-react";
import type { Dossier2DOptions } from "@/lib/pdfExport2D";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (opts: Dossier2DOptions) => void;
  isExporting: boolean;
};

const DEFAULTS: Dossier2DOptions = {
  planEmpty: true,
  planWithGames: true,
  planWithDistances: true,
  planPMR: true,
  equipmentList: true,
  budget: false,
  leasing: { enabled: false },
};

export function Export2DDossierDialog({ open, onOpenChange, onExport, isExporting }: Props) {
  const [opts, setOpts] = useState<Dossier2DOptions>({ ...DEFAULTS });

  const set = <K extends keyof Dossier2DOptions>(k: K, v: Dossier2DOptions[K]) =>
    setOpts((p) => ({ ...p, [k]: v }));

  const setLeasing = (patch: Partial<Dossier2DOptions["leasing"]>) =>
    setOpts((p) => ({ ...p, leasing: { ...p.leasing, ...patch } }));

  const planChecks: { key: keyof Dossier2DOptions; label: string; desc: string }[] = [
    { key: "planEmpty", label: "Plan 2D — coque vide", desc: "Sans les jeux, juste les murs cotés." },
    { key: "planWithGames", label: "Plan 2D — avec jeux", desc: "Implantation des équipements." },
    { key: "planWithDistances", label: "Plan 2D — distances", desc: "Espacements entre jeux et murs." },
    { key: "planPMR", label: "Plan 2D — cheminement PMR", desc: "Parcours d'accessibilité." },
  ];

  const anyPlan =
    opts.planEmpty || opts.planWithGames || opts.planWithDistances || opts.planPMR ||
    opts.equipmentList || opts.budget;

  const numInput = (val: number | undefined, onChange: (n: number | undefined) => void) => (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      value={val ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? undefined : Math.max(0, Number(v)));
      }}
      placeholder="—"
      className="h-8"
      disabled={!opts.leasing.enabled}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exporter le dossier 2D</DialogTitle>
          <DialogDescription>
            Dossier basé uniquement sur les plans 2D — idéal quand certains jeux n'ont pas de modèle 3D.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto pr-1">
          {/* Plans */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Plans 2D</p>
            {planChecks.map((c) => (
              <label
                key={c.key}
                className="flex items-start gap-3 cursor-pointer rounded-lg border border-border px-3 py-2 hover:border-primary/40 transition-colors"
              >
                <Checkbox
                  checked={opts[c.key] as boolean}
                  onCheckedChange={(v) => set(c.key, !!v as any)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium block">{c.label}</span>
                  <span className="text-xs text-muted-foreground">{c.desc}</span>
                </div>
              </label>
            ))}
          </div>

          <Separator />

          {/* Equipment list */}
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border px-3 py-2 hover:border-primary/40 transition-colors">
            <Checkbox
              checked={opts.equipmentList}
              onCheckedChange={(v) => set("equipmentList", !!v)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-sm font-medium block">Liste des jeux sélectionnés</span>
              <span className="text-xs text-muted-foreground">
                Présentation type catalogue avec lien vers avranchesautomatic.com.
              </span>
            </div>
          </label>

          <Separator />

          {/* Budget */}
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border px-3 py-2 hover:border-primary/40 transition-colors">
            <Checkbox
              checked={opts.budget}
              onCheckedChange={(v) => set("budget", !!v)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-sm font-medium block">Budget estimatif</span>
              <span className="text-xs text-muted-foreground">
                Sous-totaux par catégorie + total HT/TTC.
              </span>
            </div>
          </label>

          {/* Leasing (only visible when budget is enabled) */}
          {opts.budget && (
            <div className="rounded-lg border border-border px-3 py-3 space-y-3 bg-card/40">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={opts.leasing.enabled}
                  onCheckedChange={(v) => setLeasing({ enabled: !!v })}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium block">Mensualités de leasing</span>
                  <span className="text-xs text-muted-foreground">
                    À renseigner manuellement (montant TTC par mois).
                  </span>
                </div>
              </label>

              <div className="grid grid-cols-3 gap-2 pl-7">
                <div>
                  <Label className="text-[11px] text-muted-foreground">12 mois (€/mois)</Label>
                  {numInput(opts.leasing.monthly12, (n) => setLeasing({ monthly12: n }))}
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">24 mois (€/mois)</Label>
                  {numInput(opts.leasing.monthly24, (n) => setLeasing({ monthly24: n }))}
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">36 mois (€/mois)</Label>
                  {numInput(opts.leasing.monthly36, (n) => setLeasing({ monthly36: n }))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Annuler
          </Button>
          <Button
            onClick={() => onExport(opts)}
            disabled={!anyPlan || isExporting}
            className="gap-2"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {isExporting ? "Génération…" : "Exporter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
