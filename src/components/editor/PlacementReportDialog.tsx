import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertTriangle, X, Info } from "lucide-react";
import type { PlacementReportItem, PlacementFailureReason } from "@/lib/placement";

type Props = {
  open: boolean;
  onClose: () => void;
  placedCount: number;
  notPlacedCount: number;
  report: PlacementReportItem[];
};

const REASON_META: Record<PlacementFailureReason, { label: string; color: string }> = {
  no_closed_room:      { label: "Aucune salle fermée",   color: "bg-destructive/20 text-destructive border-destructive/40" },
  no_wall_space:       { label: "Pas de place au mur",    color: "bg-amber-500/20 text-amber-400 border-amber-500/40" },
  circulation_broken:  { label: "Circulation PMR",        color: "bg-primary/20 text-primary border-primary/40" },
  too_large:           { label: "Trop grand",             color: "bg-destructive/20 text-destructive border-destructive/40" },
  unknown:             { label: "Inconnue",               color: "bg-muted text-muted-foreground border-border" },
};

export function PlacementReportDialog({ open, onClose, placedCount, notPlacedCount, report }: Props) {
  const grouped = new Map<string, { name: string; reason: PlacementFailureReason; message: string; count: number }>();
  for (const r of report) {
    const key = `${r.equipmentId}__${r.reason}`;
    const cur = grouped.get(key);
    if (cur) cur.count++;
    else grouped.set(key, { name: r.name, reason: r.reason, message: r.message, count: 1 });
  }
  const items = [...grouped.values()];

  const hasIssues = notPlacedCount > 0 || report.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            {hasIssues
              ? <AlertTriangle className="w-5 h-5 text-amber-400" />
              : <CheckCircle2 className="w-5 h-5 text-primary" />}
            Rapport de placement
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {placedCount} jeu{placedCount > 1 ? "x" : ""} placé{placedCount > 1 ? "s" : ""}
            {notPlacedCount > 0 && (
              <> · <span className="text-amber-400">{notPlacedCount} non placé{notPlacedCount > 1 ? "s" : ""}</span></>
            )}
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <div className="flex items-center gap-3 p-6 rounded-lg bg-primary/10 border border-primary/30 text-primary">
            <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
            <div>
              <div className="font-medium">Tout est en ordre</div>
              <div className="text-sm text-primary/80">Tous les jeux ont été placés avec succès.</div>
            </div>
          </div>
        ) : (
          <ScrollArea className="max-h-[420px] pr-2">
            <ul className="space-y-2">
              {items.map((it, i) => {
                const meta = REASON_META[it.reason];
                return (
                  <li key={i} className="flex items-start gap-3 p-3 rounded-md bg-muted/40 border border-border">
                    <Info className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground truncate">{it.name}</span>
                        {it.count > 1 && (
                          <Badge variant="outline" className="h-5 text-[10px] px-1.5">×{it.count}</Badge>
                        )}
                        <Badge variant="outline" className={`h-5 text-[10px] px-1.5 ${meta.color}`}>
                          {meta.label}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{it.message}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={onClose} className="gap-2">
            <X className="w-4 h-4" />
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
