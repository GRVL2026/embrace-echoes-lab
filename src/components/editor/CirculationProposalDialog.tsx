import React, { useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, X } from "lucide-react";
import type { RemovalProposal } from "@/lib/circulation";
import type { PlacedEquipment } from "@/types/equipment";
import type { Point, Room, Door, Pillar } from "@/types/editor";
import { CM_TO_PX } from "@/types/editor";

type Props = {
  open: boolean;
  proposals: RemovalProposal[];
  rooms: Room[];
  doors: Door[];
  pillars: Pillar[];
  allEquipments: PlacedEquipment[];
  onAccept: (proposal: RemovalProposal) => void;
  onCancel: () => void;
};

export function CirculationProposalDialog({
  open,
  proposals,
  rooms,
  doors,
  pillars,
  allEquipments,
  onAccept,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Circulation impossible
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            La disposition actuelle ne permet pas de maintenir un couloir de circulation de 1,40m.
            Voici des propositions de retrait de jeux pour rétablir la conformité.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 mt-4">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              rooms={rooms}
              doors={doors}
              pillars={pillars}
              allEquipments={allEquipments}
              onAccept={() => onAccept(proposal)}
            />
          ))}
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onCancel} className="gap-2">
            <X className="w-4 h-4" />
            Ignorer et garder la disposition actuelle
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProposalCard({
  proposal,
  rooms,
  doors,
  pillars,
  allEquipments,
  onAccept,
}: {
  proposal: RemovalProposal;
  rooms: Room[];
  doors: Door[];
  pillars: Pillar[];
  allEquipments: PlacedEquipment[];
  onAccept: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Find bounds of all rooms
    const allPts = rooms.flatMap(r => r.points);
    if (allPts.length === 0) return;
    const minX = Math.min(...allPts.map(p => p.x));
    const maxX = Math.max(...allPts.map(p => p.x));
    const minY = Math.min(...allPts.map(p => p.y));
    const maxY = Math.max(...allPts.map(p => p.y));

    const padding = 20;
    const scaleX = (width - padding * 2) / ((maxX - minX) * CM_TO_PX || 1);
    const scaleY = (height - padding * 2) / ((maxY - minY) * CM_TO_PX || 1);
    const scale = Math.min(scaleX, scaleY);

    ctx.save();
    ctx.translate(padding, padding);
    ctx.scale(scale, scale);
    ctx.translate(-minX * CM_TO_PX, -minY * CM_TO_PX);

    // Draw rooms
    rooms.forEach(room => {
      if (room.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(room.points[0].x * CM_TO_PX, room.points[0].y * CM_TO_PX);
      room.points.forEach((p, i) => { if (i > 0) ctx.lineTo(p.x * CM_TO_PX, p.y * CM_TO_PX); });
      if (room.isClosed) {
        ctx.closePath();
        ctx.fillStyle = "hsla(240, 40%, 10%, 0.8)";
        ctx.fill();
      }
      ctx.strokeStyle = "hsl(263, 85%, 68%)";
      ctx.lineWidth = 2 / scale;
      ctx.stroke();
    });

    // Draw remaining equipment (green-ish)
    const removeSet = new Set(proposal.equipmentIdsToRemove);
    allEquipments.forEach(eq => {
      const isRemoved = removeSet.has(eq.id);
      const cx = eq.position.x * CM_TO_PX;
      const cy = eq.position.y * CM_TO_PX;
      const w = eq.width * CM_TO_PX;
      const d = eq.depth * CM_TO_PX;
      const rot = (eq.rotation || 0) * Math.PI / 180;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);

      if (isRemoved) {
        // Removed equipment: red strikethrough
        ctx.fillStyle = "hsla(0, 85%, 60%, 0.2)";
        ctx.fillRect(-w / 2, -d / 2, w, d);
        ctx.strokeStyle = "hsl(0, 85%, 60%)";
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.strokeRect(-w / 2, -d / 2, w, d);
        ctx.setLineDash([]);
        // X mark
        ctx.beginPath();
        ctx.moveTo(-w / 3, -d / 3);
        ctx.lineTo(w / 3, d / 3);
        ctx.moveTo(w / 3, -d / 3);
        ctx.lineTo(-w / 3, d / 3);
        ctx.strokeStyle = "hsl(0, 85%, 60%)";
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      } else {
        ctx.fillStyle = eq.color.replace(")", ", 0.3)").replace("hsl(", "hsla(");
        ctx.fillRect(-w / 2, -d / 2, w, d);
        ctx.strokeStyle = eq.color;
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeRect(-w / 2, -d / 2, w, d);
      }

      ctx.restore();
    });

    // Draw circulation path
    if (proposal.resultingCirculation.length > 0) {
      const hw = 140 * CM_TO_PX / 2; // corridor half-width

      // Build chain
      const chain: Point[] = [proposal.resultingCirculation[0].start];
      for (const seg of proposal.resultingCirculation) {
        chain.push(seg.end);
      }

      // Centerline
      ctx.beginPath();
      ctx.moveTo(chain[0].x * CM_TO_PX, chain[0].y * CM_TO_PX);
      for (let i = 1; i < chain.length; i++) {
        ctx.lineTo(chain[i].x * CM_TO_PX, chain[i].y * CM_TO_PX);
      }
      ctx.strokeStyle = "hsla(142, 70%, 50%, 0.6)";
      ctx.lineWidth = 3 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw pillars
    pillars.forEach(pillar => {
      ctx.save();
      ctx.translate(pillar.position.x * CM_TO_PX, pillar.position.y * CM_TO_PX);
      ctx.rotate((pillar.rotation || 0) * Math.PI / 180);
      if (pillar.shape === "round") {
        ctx.beginPath();
        ctx.arc(0, 0, pillar.width / 2 * CM_TO_PX, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(30, 60%, 40%, 0.6)";
        ctx.fill();
        ctx.strokeStyle = "hsl(30, 60%, 50%)";
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      } else {
        const pw = pillar.width * CM_TO_PX, pd = pillar.depth * CM_TO_PX;
        ctx.fillStyle = "hsla(30, 60%, 40%, 0.6)";
        ctx.fillRect(-pw / 2, -pd / 2, pw, pd);
        ctx.strokeStyle = "hsl(30, 60%, 50%)";
        ctx.lineWidth = 1 / scale;
        ctx.strokeRect(-pw / 2, -pd / 2, pw, pd);
      }
      ctx.restore();
    });

    ctx.restore();
  }, [proposal, rooms, doors, pillars, allEquipments]);

  return (
    <div className="border border-border rounded-lg p-4 bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-4">
        <canvas
          ref={canvasRef}
          width={280}
          height={200}
          className="rounded border border-border bg-background flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-foreground mb-2">
            {proposal.label}
          </h3>
          <p className="text-sm text-muted-foreground mb-2">
            Jeux à retirer :
          </p>
          <ul className="text-sm space-y-1 mb-4">
            {proposal.removedNames.map((name, i) => (
              <li key={i} className="flex items-center gap-2 text-destructive">
                <X className="w-3 h-3 flex-shrink-0" />
                {name}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mb-3">
            {proposal.remainingEquipments.length} jeu(x) conservé(s)
          </p>
          <Button onClick={onAccept} size="sm" className="gap-2">
            <Check className="w-4 h-4" />
            Appliquer cette proposition
          </Button>
        </div>
      </div>
    </div>
  );
}
