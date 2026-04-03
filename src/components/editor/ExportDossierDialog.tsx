import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileDown, Loader2 } from "lucide-react";

export type DossierSections = {
  cover: boolean;
  plan2d: boolean;
  plan2dMeasured: boolean;
  views3d: boolean;
  equipmentList: boolean;
  budget: boolean;
  productSheets: boolean;
};

const DEFAULT_SECTIONS: DossierSections = {
  cover: true,
  plan2d: true,
  plan2dMeasured: true,
  views3d: true,
  equipmentList: true,
  budget: true,
  productSheets: true,
};

const SECTION_LABELS: Record<keyof DossierSections, string> = {
  cover: "Page de couverture",
  plan2d: "Plan 2D",
  views3d: "Vues 3D",
  equipmentList: "Liste des équipements",
  budget: "Budget estimatif",
  productSheets: "Fiches produits (annexe)",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (sections: DossierSections) => void;
  isExporting: boolean;
};

export function ExportDossierDialog({ open, onOpenChange, onExport, isExporting }: Props) {
  const [sections, setSections] = useState<DossierSections>({ ...DEFAULT_SECTIONS });

  const toggle = (key: keyof DossierSections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const anySelected = Object.values(sections).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exporter le dossier PDF</DialogTitle>
          <DialogDescription>
            Sélectionnez les sections à inclure dans le dossier.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {(Object.keys(SECTION_LABELS) as (keyof DossierSections)[]).map((key) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer rounded-lg border border-border px-3 py-2.5 hover:border-primary/40 transition-colors"
            >
              <Checkbox
                checked={sections[key]}
                onCheckedChange={() => toggle(key)}
              />
              <span className="text-sm font-medium">{SECTION_LABELS[key]}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Annuler
          </Button>
          <Button
            onClick={() => onExport(sections)}
            disabled={!anySelected || isExporting}
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
