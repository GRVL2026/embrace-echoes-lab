import { useEditor } from "@/contexts/EditorContext";
import { Trash2, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Door } from "@/types/editor";

type AIPlanDoor = {
  edgeIndex: number;
  positionRatio: number;
  width: number;
  openDirection: "left" | "right";
  openSide: "interior" | "exterior";
  leafCount: "single" | "double";
};

type AIPlanRoom = {
  name: string;
  points: { x: number; y: number }[];
  isClosed: boolean;
  doors?: AIPlanDoor[];
};

export function EditorSidebar() {
  const { state, dispatch } = useEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleImportPlan = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Veuillez sélectionner une image");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 10 Mo");
      return;
    }

    setIsAnalyzing(true);
    toast.info("Analyse du plan en cours...", { duration: 10000, id: "analyzing" });

    try {
      // Convert to base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      const { data, error } = await supabase.functions.invoke("analyze-plan", {
        body: { imageBase64: base64, mimeType: file.type },
      });

      if (error) throw new Error(error.message || "Erreur lors de l'analyse");
      if (data?.error) throw new Error(data.error);

      const planData = data as { rooms: AIPlanRoom[] };

      if (!planData.rooms || planData.rooms.length === 0) {
        toast.error("Aucune pièce détectée dans le plan");
        return;
      }

      // Inject rooms and doors into editor
      planData.rooms.forEach((aiRoom) => {
        const roomId = crypto.randomUUID();

        dispatch({
          type: "ADD_ROOM",
          room: {
            id: roomId,
            points: aiRoom.points,
            walls: [],
            name: aiRoom.name || `Salle ${state.rooms.length + 1}`,
            isClosed: aiRoom.isClosed !== false,
          },
        });

        // Add doors for this room
        if (aiRoom.doors) {
          aiRoom.doors.forEach((aiDoor) => {
            const door: Door = {
              id: crypto.randomUUID(),
              roomId,
              edgeIndex: aiDoor.edgeIndex,
              positionRatio: Math.max(0.1, Math.min(0.9, aiDoor.positionRatio)),
              width: aiDoor.width || 80,
              openDirection: aiDoor.openDirection || "left",
              openSide: aiDoor.openSide || "interior",
              leafCount: aiDoor.leafCount || "single",
            };
            dispatch({ type: "ADD_DOOR", door });
          });
        }
      });

      toast.dismiss("analyzing");
      toast.success(
        `Plan importé : ${planData.rooms.length} pièce${planData.rooms.length > 1 ? "s" : ""} détectée${planData.rooms.length > 1 ? "s" : ""}`
      );
    } catch (err) {
      console.error("Import error:", err);
      toast.dismiss("analyzing");
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'import du plan");
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex w-72 flex-col border-l border-border bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="font-display text-lg font-bold text-foreground">Salles</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {state.rooms.length === 0 && state.pillars.length === 0
            ? "Dessinez ou importez un plan"
            : `${state.rooms.length} salle${state.rooms.length > 1 ? "s" : ""}${state.pillars.length > 0 ? ` · ${state.pillars.length} poteau${state.pillars.length > 1 ? "x" : ""}` : ""}`}
        </p>
      </div>

      {/* Import button */}
      <div className="border-b border-border p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportPlan(file);
          }}
        />
        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={isAnalyzing}
          onClick={() => fileInputRef.current?.click()}
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse en cours...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Importer un plan (image)
            </>
          )}
        </Button>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          L'IA analysera l'image pour extraire les pièces, dimensions et portes
        </p>
      </div>

      {/* Rooms list */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {state.rooms.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Utilisez l'outil{" "}
                <span className="text-secondary font-medium">Mur (W)</span> pour
                dessiner ou importez une image de plan.
              </p>
            </div>
          )}
          {state.rooms.map((room) => {
            // Calculate area (only meaningful for closed rooms)
            let area = 0;
            const pts = room.points;
            if (room.isClosed) {
              for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                area += pts[i].x * pts[j].y;
                area -= pts[j].x * pts[i].y;
              }
              area = Math.abs(area) / 2 / 10000;
            }

            // Calculate perimeter
            let perimeter = 0;
            const edgeCount = room.isClosed ? pts.length : pts.length - 1;
            for (let i = 0; i < edgeCount; i++) {
              const j = (i + 1) % pts.length;
              const dx = pts[j].x - pts[i].x;
              const dy = pts[j].y - pts[i].y;
              perimeter += Math.sqrt(dx * dx + dy * dy);
            }

            const doorCount = state.doors.filter((d) => d.roomId === room.id).length;

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
                  {room.isClosed && (
                    <div>
                      <span className="text-accent">{area.toFixed(1)}</span> m²
                    </div>
                  )}
                  <div>
                    <span className="text-accent">
                      {(perimeter / 100).toFixed(1)}
                    </span>{" "}
                    m {room.isClosed ? "périmètre" : "longueur"}
                  </div>
                  <div>
                    {pts.length} <span>points</span>
                  </div>
                  {doorCount > 0 && (
                    <div>
                      {doorCount} <span>porte{doorCount > 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Pillars section */}
          {state.pillars.length > 0 && (
            <div className="mt-4">
              <h3 className="font-display text-sm font-semibold text-foreground mb-2">Poteaux</h3>
              {state.pillars.map((pillar) => (
                <div
                  key={pillar.id}
                  className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary/40 mb-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display font-semibold text-sm text-foreground">
                      {pillar.shape === "round" ? "Poteau rond" : "Poteau carré"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive/60 hover:text-destructive"
                      onClick={() => dispatch({ type: "DELETE_PILLAR", id: pillar.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span className="text-accent">
                      {pillar.shape === "round"
                        ? `Ø${pillar.width}cm`
                        : `${pillar.width}×${pillar.depth}cm`}
                    </span>
                    {" · "}
                    <span>{Math.round(pillar.position.x)}cm, {Math.round(pillar.position.y)}cm</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
