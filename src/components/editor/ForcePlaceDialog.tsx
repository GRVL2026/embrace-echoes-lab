import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Hand, X } from "lucide-react";
import type { GameEquipment } from "@/types/equipment";

type Props = {
  open: boolean;
  notPlacedEquipments: GameEquipment[];
  onForcePlace: (equipments: GameEquipment[]) => void;
  onCancel: () => void;
};

export function ForcePlaceDialog({ open, notPlacedEquipments, onForcePlace, onCancel }: Props) {
  if (notPlacedEquipments.length === 0) return null;

  // Deduplicate by id with count
  const grouped = new Map<string, { eq: GameEquipment; count: number }>();
  for (const eq of notPlacedEquipments) {
    const existing = grouped.get(eq.id);
    if (existing) existing.count++;
    else grouped.set(eq.id, { eq, count: 1 });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            Espace insuffisant
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Le moteur de placement n'a pas pu positionner les jeux suivants
            automatiquement (pas assez d'espace libre ou contraintes de circulation).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 my-3 max-h-[40vh] overflow-y-auto">
          {Array.from(grouped.values()).map(({ eq, count }) => (
            <div
              key={eq.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/40 border border-border"
            >
              {eq.icon ? (
                <span className="text-xl flex-shrink-0">{eq.icon}</span>
              ) : (
                <div
                  className="w-8 h-8 rounded flex-shrink-0"
                  style={{ backgroundColor: eq.color || "hsl(263, 85%, 68%)" }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{eq.name}</p>
                <p className="text-xs text-muted-foreground">
                  {eq.width}×{eq.depth}×{eq.height} cm
                </p>
              </div>
              {count > 1 && (
                <span className="text-xs font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">
                  ×{count}
                </span>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="gap-2">
            <X className="w-4 h-4" />
            Annuler
          </Button>
          <Button onClick={() => onForcePlace(notPlacedEquipments)} className="gap-2">
            <Hand className="w-4 h-4" />
            Ajouter quand même (placement manuel)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
