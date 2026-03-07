import React, { useState, useEffect } from "react";
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
import type { DoorOpenDirection, DoorOpenSide, DoorLeafCount, Door } from "@/types/editor";
import { cn } from "@/lib/utils";

interface DoorDialogResult {
  width: number;
  positionRatio: number;
  openDirection: DoorOpenDirection;
  openDirectionRight?: DoorOpenDirection;
  openSide: DoorOpenSide;
  leafCount: DoorLeafCount;
}

interface DoorDialogProps {
  open: boolean;
  wallLength: number;
  initialValues?: Door;
  onConfirm: (result: DoorDialogResult) => void;
  onCancel: () => void;
}

export function DoorDialog({ open, wallLength, initialValues, onConfirm, onCancel }: DoorDialogProps) {
  const [width, setWidth] = useState(80);
  const [position, setPosition] = useState(Math.round(wallLength / 2));
  const [direction, setDirection] = useState<DoorOpenDirection>("left");
  const [directionRight, setDirectionRight] = useState<DoorOpenDirection>("right");
  const [openSide, setOpenSide] = useState<DoorOpenSide>("interior");
  const [leafCount, setLeafCount] = useState<DoorLeafCount>("single");

  // Pre-fill values when editing an existing door
  useEffect(() => {
    if (initialValues) {
      setWidth(initialValues.width);
      const centerDist = initialValues.positionRatio * wallLength;
      setPosition(Math.round(centerDist - initialValues.width / 2));
      setDirection(initialValues.openDirection);
      setDirectionRight(initialValues.openDirectionRight || "right");
      setOpenSide(initialValues.openSide);
      setLeafCount(initialValues.leafCount);
    } else {
      setWidth(80);
      setPosition(Math.round(wallLength / 2));
      setDirection("left");
      setDirectionRight("right");
      setOpenSide("interior");
      setLeafCount("single");
    }
  }, [initialValues, wallLength]);

  const maxPosition = Math.max(0, wallLength - width);

  const handleConfirm = () => {
    const clampedPos = Math.max(0, Math.min(position, maxPosition));
    const ratio = wallLength > 0 ? (clampedPos + width / 2) / wallLength : 0.5;
    onConfirm({
      width,
      positionRatio: ratio,
      openDirection: direction,
      openDirectionRight: leafCount === "double" ? directionRight : undefined,
      openSide,
      leafCount,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {initialValues ? "Modifier la porte" : "Ajouter une porte"}
          </DialogTitle>
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
              max={Math.min(300, wallLength)}
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
            <Label>Type de porte</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={leafCount === "single" ? "default" : "outline"}
                size="sm"
                className={cn(leafCount === "single" && "bg-primary text-primary-foreground")}
                onClick={() => setLeafCount("single")}
              >
                Simple battant
              </Button>
              <Button
                type="button"
                variant={leafCount === "double" ? "default" : "outline"}
                size="sm"
                className={cn(leafCount === "double" && "bg-primary text-primary-foreground")}
                onClick={() => setLeafCount("double")}
              >
                Double battant
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ouverture vers</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={openSide === "interior" ? "default" : "outline"}
                size="sm"
                className={cn(openSide === "interior" && "bg-primary text-primary-foreground")}
                onClick={() => setOpenSide("interior")}
              >
                🏠 Intérieur
              </Button>
              <Button
                type="button"
                variant={openSide === "exterior" ? "default" : "outline"}
                size="sm"
                className={cn(openSide === "exterior" && "bg-primary text-primary-foreground")}
                onClick={() => setOpenSide("exterior")}
              >
                🚪 Extérieur
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              {leafCount === "single" ? "Sens d'ouverture" : "Sens battant gauche"}
            </Label>
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

          {leafCount === "double" && (
            <div className="space-y-2">
              <Label>Sens battant droit</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={directionRight === "left" ? "default" : "outline"}
                  size="sm"
                  className={cn(directionRight === "left" && "bg-primary text-primary-foreground")}
                  onClick={() => setDirectionRight("left")}
                >
                  ↰ Gauche
                </Button>
                <Button
                  type="button"
                  variant={directionRight === "right" ? "default" : "outline"}
                  size="sm"
                  className={cn(directionRight === "right" && "bg-primary text-primary-foreground")}
                  onClick={() => setDirectionRight("right")}
                >
                  ↱ Droite
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={width > wallLength}>
            {initialValues ? "Modifier" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
