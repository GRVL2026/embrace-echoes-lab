import { useState, useEffect } from "react";
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
import { cn } from "@/lib/utils";
import type { Pillar, PillarShape } from "@/types/editor";

interface PillarDialogProps {
  open: boolean;
  pillar: Pillar;
  onConfirm: (updates: Partial<Pillar>) => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function PillarDialog({ open, pillar, onConfirm, onDelete, onCancel }: PillarDialogProps) {
  const [shape, setShape] = useState<PillarShape>(pillar.shape);
  const [width, setWidth] = useState(pillar.width);
  const [depth, setDepth] = useState(pillar.depth);
  const [height, setHeight] = useState(pillar.height);
  const [rotation, setRotation] = useState(pillar.rotation || 0);
  const [sizeMode, setSizeMode] = useState<"diameter" | "perimeter">("diameter");

  useEffect(() => {
    setShape(pillar.shape);
    setWidth(pillar.width);
    setDepth(pillar.depth);
    setHeight(pillar.height);
    setRotation(pillar.rotation || 0);
  }, [pillar]);

  // For round pillars: convert perimeter ↔ diameter
  const diameterFromPerimeter = (p: number) => Math.round((p / Math.PI) * 10) / 10;
  const perimeterFromDiameter = (d: number) => Math.round(d * Math.PI * 10) / 10;

  const displayRoundValue = sizeMode === "diameter" ? width : perimeterFromDiameter(width);

  const handleRoundValueChange = (val: number) => {
    if (sizeMode === "diameter") {
      setWidth(val);
    } else {
      setWidth(diameterFromPerimeter(val));
    }
  };

  const handleConfirm = () => {
    onConfirm({
      shape,
      width,
      depth: shape === "round" ? width : depth,
      height,
      rotation,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Configurer le poteau</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Shape selection */}
          <div className="space-y-2">
            <Label>Forme</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={shape === "square" ? "default" : "outline"}
                size="sm"
                className={cn(shape === "square" && "bg-primary text-primary-foreground")}
                onClick={() => setShape("square")}
              >
                ▬ Rectangulaire
              </Button>
              <Button
                type="button"
                variant={shape === "round" ? "default" : "outline"}
                size="sm"
                className={cn(shape === "round" && "bg-primary text-primary-foreground")}
                onClick={() => setShape("round")}
              >
                ● Rond
              </Button>
            </div>
          </div>

          {shape === "square" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="pillar-width">Largeur (cm)</Label>
                <Input
                  id="pillar-width"
                  type="number"
                  min={5}
                  max={500}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pillar-depth">Profondeur (cm)</Label>
                <Input
                  id="pillar-depth"
                  type="number"
                  min={5}
                  max={500}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="font-mono"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Définir par</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={sizeMode === "diameter" ? "default" : "outline"}
                    size="sm"
                    className={cn(sizeMode === "diameter" && "bg-primary text-primary-foreground")}
                    onClick={() => setSizeMode("diameter")}
                  >
                    Diamètre
                  </Button>
                  <Button
                    type="button"
                    variant={sizeMode === "perimeter" ? "default" : "outline"}
                    size="sm"
                    className={cn(sizeMode === "perimeter" && "bg-primary text-primary-foreground")}
                    onClick={() => setSizeMode("perimeter")}
                  >
                    Périmètre
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pillar-round-size">
                  {sizeMode === "diameter" ? "Diamètre (cm)" : "Périmètre (cm)"}
                </Label>
                <Input
                  id="pillar-round-size"
                  type="number"
                  min={5}
                  max={1000}
                  step={0.1}
                  value={displayRoundValue}
                  onChange={(e) => handleRoundValueChange(Number(e.target.value))}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {sizeMode === "diameter"
                    ? `Périmètre : ${perimeterFromDiameter(width)}cm`
                    : `Diamètre : ${width}cm`}
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="pillar-height">Hauteur (cm)</Label>
            <Input
              id="pillar-height"
              type="number"
              min={10}
              max={2000}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pillar-rotation">Rotation (°)</Label>
            <Input
              id="pillar-rotation"
              type="number"
              min={-180}
              max={180}
              step={1}
              value={Math.round(rotation)}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Supprimer
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
            <Button onClick={handleConfirm}>
              Appliquer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
