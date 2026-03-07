import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DoorOpenDirection } from "@/types/editor";
import { cn } from "@/lib/utils";

interface DoorDialogProps {
  open: boolean;
  wallLength: number; // cm
  onConfirm: (width: number, positionRatio: number, openDirection: DoorOpenDirection) => void;
  onCancel: () => void;
}

export function DoorDialog({ open, wallLength, onConfirm, onCancel }: DoorDialogProps) {
  const [width, setWidth] = useState(80);
  const [position, setPosition] = useState(Math.round(wallLength / 2));
  const [direction, setDirection] = useState<DoorOpenDirection>("left");

  const maxPosition = Math.max(0, wallLength - width);

  const handleConfirm = () => {
    const clampedPos = Math.max(0, Math.min(position, maxPosition));
    const ratio = wallLength > 0 ? (clampedPos + width / 2) / wallLength : 0.5;
    onConfirm(width, ratio, direction);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Ajouter une porte</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm text-muted-foreground">
            Longueur du mur : <span className="font-mono text-foreground">{Math.round(wallLength)}cm</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="door-width">Largeur de la porte (cm)</Label>
            <Input
              id="door-width"
              type="number"
              min={40}
              max={Math.min(200, wallLength)}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="door-position">Position depuis le début du mur (cm)</Label>
            <Input
              id="door-position"
              type="number"
              min={0}
              max={maxPosition}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="font-mono"
            />
            <div className="h-3 rounded-full bg-muted relative overflow-hidden">
              <div
                className="absolute top-0 h-full bg-primary rounded-full"
                style={{
                  left: `${(position / wallLength) * 100}%`,
                  width: `${(width / wallLength) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sens d'ouverture</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === "left" ? "default" : "outline"}
                size="sm"
                className={cn(direction === "left" && "bg-primary text-primary-foreground")}
                onClick={() => setDirection("left")}
              >
                ↰ Gauche
              </Button>
              <Button
                type="button"
                variant={direction === "right" ? "default" : "outline"}
                size="sm"
                className={cn(direction === "right" && "bg-primary text-primary-foreground")}
                onClick={() => setDirection("right")}
              >
                ↱ Droite
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={width > wallLength}>
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
