import { useEditor } from "@/contexts/EditorContext";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function EditorSidebar() {
  const { state, dispatch } = useEditor();

  return (
    <div className="flex w-72 flex-col border-l border-border bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="font-display text-lg font-bold text-foreground">
          Salles
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {state.rooms.length === 0
            ? "Dessinez votre première salle"
            : `${state.rooms.length} salle${state.rooms.length > 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Rooms list */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {state.rooms.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Utilisez l'outil <span className="text-secondary font-medium">Mur (W)</span> pour dessiner les contours de votre salle.
              </p>
            </div>
          )}
          {state.rooms.map((room) => {
            // Calculate area
            let area = 0;
            const pts = room.points;
            for (let i = 0; i < pts.length; i++) {
              const j = (i + 1) % pts.length;
              area += pts[i].x * pts[j].y;
              area -= pts[j].x * pts[i].y;
            }
            area = Math.abs(area) / 2 / 10000; // cm² to m²

            // Calculate perimeter
            let perimeter = 0;
            for (let i = 0; i < pts.length; i++) {
              const j = (i + 1) % pts.length;
              const dx = pts[j].x - pts[i].x;
              const dy = pts[j].y - pts[i].y;
              perimeter += Math.sqrt(dx * dx + dy * dy);
            }

            return (
              <div
                key={room.id}
                className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display font-semibold text-sm text-foreground">
                    {room.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive/60 hover:text-destructive"
                    onClick={() => dispatch({ type: "DELETE_ROOM", id: room.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="text-accent">{area.toFixed(1)}</span> m²
                  </div>
                  <div>
                    <span className="text-accent">{(perimeter / 100).toFixed(1)}</span> m périmètre
                  </div>
                  <div>
                    {pts.length} <span>côtés</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
