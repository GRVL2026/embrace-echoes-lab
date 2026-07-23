import { useEditor } from "@/contexts/EditorContext";
import { Trash2, Upload, Loader2, FileImage, FileText, FileUp, Home, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Door } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { CatalogPanel } from "./CatalogPanel";

import { SidebarSection } from "./SidebarSection";
import { pdfToImage } from "@/lib/pdfUtils";

type AIPlanDoor = {
  edgeIndex: number;
  positionRatio: number;
  width: number;
  openDirection: "left" | "right";
  openSide: "interior" | "exterior";
  leafCount: "single" | "double";
};

type AIEquipment = {
  name: string;
  category: string;
  position: { x: number; y: number };
  width: number;
  depth: number;
  rotation: number;
};

type AIPlanRoom = {
  name: string;
  points: { x: number; y: number }[];
  isClosed: boolean;
  doors?: AIPlanDoor[];
};

type AnalysisStep = "reading" | "converting" | "analyzing" | "importing" | "done";

const STEP_LABELS: Record<AnalysisStep, string> = {
  reading: "Lecture du fichier…",
  converting: "Conversion PDF → image…",
  analyzing: "Analyse IA en cours…",
  importing: "Import des données…",
  done: "Terminé !",
};

const STEP_PROGRESS: Record<AnalysisStep, number> = {
  reading: 10,
  converting: 25,
  analyzing: 60,
  importing: 90,
  done: 100,
};

type EditorSidebarProps = {
  catalog: GameEquipment[];
  setCatalog: React.Dispatch<React.SetStateAction<GameEquipment[]>>;
};

export function EditorSidebar({ catalog, setCatalog }: EditorSidebarProps) {
  const { state, dispatch } = useEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<AnalysisStep | null>(null);
  const handleImportPlan = async (file: File) => {
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");

    if (!isPdf && !isImage) {
      toast.error("Format non supporté. Utilisez une image (JPG, PNG) ou un PDF.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error("Le fichier ne doit pas dépasser 20 Mo");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisStep("reading");

    try {
      let base64: string;
      let mimeType: string;

      if (isPdf) {
        setAnalysisStep("converting");
        const result = await pdfToImage(file, { scale: 2.5 });
        base64 = result.base64;
        mimeType = result.mimeType;
      } else {
        const buffer = await file.arrayBuffer();
        base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );
        mimeType = file.type;
      }

      setAnalysisStep("analyzing");

      const { data, error } = await supabase.functions.invoke("analyze-plan", {
        body: { imageBase64: base64, mimeType },
      });

      if (error) throw new Error(error.message || "Erreur lors de l'analyse");
      if (data?.error) throw new Error(data.error);

      setAnalysisStep("importing");

      const planData = data as {
        rooms: AIPlanRoom[];
        equipment?: AIEquipment[];
        pillars?: { position: { x: number; y: number }; shape?: string; width: number; depth?: number }[];
        confidence?: { dimensions?: string; notes?: string };
        scale?: { confidence?: string };
      };

      if (!planData.rooms || planData.rooms.length === 0) {
        toast.error("Aucune pièce détectée dans le plan");
        return;
      }

      // Inject rooms and doors
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

      // Inject detected pillars
      let pillarCount = 0;
      if (planData.pillars && planData.pillars.length > 0) {
        planData.pillars.forEach((p) => {
          dispatch({
            type: "ADD_PILLAR",
            pillar: {
              id: crypto.randomUUID(),
              position: p.position,
              shape: (p.shape === "round" ? "round" : "square") as "square" | "round",
              width: p.width || 30,
              depth: p.depth || p.width || 30,
              height: 300,
              rotation: 0,
            },
          });
          pillarCount++;
        });
      }

      // Inject detected equipment
      let equipCount = 0;
      if (planData.equipment && planData.equipment.length > 0) {
        planData.equipment.forEach((eq) => {
          const placed: PlacedEquipment = {
            id: crypto.randomUUID(),
            equipmentId: `ai-detected-${crypto.randomUUID()}`,
            position: eq.position,
            rotation: eq.rotation || 0,
            name: eq.name,
            width: eq.width || 100,
            depth: eq.depth || 80,
            safetyZone: 10,
            color: getCategoryColor(eq.category),
          };
          dispatch({ type: "ADD_PLACED_EQUIPMENT", equipment: placed });
          equipCount++;
        });
      }

      setAnalysisStep("done");

      const confidenceInfo = planData.confidence?.dimensions
        ? ` (précision: ${planData.confidence.dimensions})`
        : "";

      const parts = [
        `${planData.rooms.length} pièce${planData.rooms.length > 1 ? "s" : ""}`,
        pillarCount > 0 ? `${pillarCount} poteau${pillarCount > 1 ? "x" : ""}` : null,
        equipCount > 0 ? `${equipCount} équipement${equipCount > 1 ? "s" : ""}` : null,
      ].filter(Boolean).join(", ");

      toast.success(`Plan importé : ${parts}${confidenceInfo}`);
    } catch (err) {
      console.error("Import error:", err);
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'import du plan");
    } finally {
      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisStep(null);
      }, 1500);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Budget estimation
  const budgetTotal = useMemo(() => {
    let total = 0;
    state.placedEquipments.forEach((eq) => {
      const catItem = catalog.find(c => c.id === eq.equipmentId);
      if (catItem?.price) total += catItem.price;
    });
    return total;
  }, [state.placedEquipments, catalog]);

  return (
    <div className="flex w-72 flex-col border-l border-border bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="font-display text-lg font-bold text-foreground">Projet</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {state.rooms.length === 0 && state.pillars.length === 0
            ? "Dessinez ou importez un plan"
            : `${state.rooms.length} salle${state.rooms.length > 1 ? "s" : ""}${state.pillars.length > 0 ? ` · ${state.pillars.length} poteau${state.pillars.length > 1 ? "x" : ""}` : ""}`}
        </p>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overscroll-contain">
        {/* === Section Import === */}
        <SidebarSection title="Import" icon={FileUp} defaultOpen={state.rooms.length === 0}>
          <div className="p-3 pt-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
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
                  {analysisStep ? STEP_LABELS[analysisStep] : "Analyse…"}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Importer un plan
                </>
              )}
            </Button>

            {isAnalyzing && analysisStep && (
              <div className="mt-3 space-y-1.5">
                <Progress value={STEP_PROGRESS[analysisStep]} className="h-2" />
                <p className="text-[10px] text-muted-foreground text-center">
                  {STEP_LABELS[analysisStep]}
                </p>
              </div>
            )}

            {!isAnalyzing && (
              <div className="flex items-center gap-2 mt-2 justify-center">
                <FileImage className="h-3 w-3 text-muted-foreground" />
                <FileText className="h-3 w-3 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">
                  Images (JPG, PNG) et PDF supportés
                </p>
              </div>
            )}
          </div>
        </SidebarSection>

        {/* === Section Salle === */}
        <SidebarSection title="Salle" icon={Home} badge={state.rooms.length || undefined}>
          <div className="space-y-2 p-3 pt-0">
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

              let pillarArea = 0;
              if (room.isClosed) {
                state.pillars.forEach((pillar) => {
                  const { x: testX, y: testY } = pillar.position;
                  let inside = false;
                  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                    const xi = pts[i].x, yi = pts[i].y;
                    const xj = pts[j].x, yj = pts[j].y;
                    if (((yi > testY) !== (yj > testY)) && (testX < (xj - xi) * (testY - yi) / (yj - yi) + xi)) {
                      inside = !inside;
                    }
                  }
                  if (inside) {
                    if (pillar.shape === "round") {
                      const r = pillar.width / 2;
                      pillarArea += Math.PI * r * r / 10000;
                    } else {
                      pillarArea += (pillar.width * pillar.depth) / 10000;
                    }
                  }
                });
              }

              const netArea = area - pillarArea;

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
                      <>
                        <div>
                          <span className="text-accent">{area.toFixed(1)}</span> m² brut
                        </div>
                        <div>
                          <span className="text-accent">{netArea.toFixed(1)}</span> m² net
                        </div>
                      </>
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
              <div className="mt-2">
                <h4 className="font-display text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Poteaux</h4>
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
        </SidebarSection>

        {/* === Section Budget === */}
        <SidebarSection title="Budget" icon={Wallet} defaultOpen={state.placedEquipments.length > 0}>
          <div className="p-3 pt-0">
            {state.placedEquipments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                Placez des jeux pour voir l'estimation
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Jeux placés</span>
                  <span className="text-accent font-semibold">{state.placedEquipments.length}</span>
                </div>
                {budgetTotal > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Budget estimé</span>
                    <span className="text-primary font-bold">
                      {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(budgetTotal)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Catégories</span>
                  <span className="text-accent font-semibold">
                    {new Set(state.placedEquipments.map(e => catalog.find(c => c.id === e.equipmentId)?.category).filter(Boolean)).size}
                  </span>
                </div>
              </div>
            )}
          </div>
        </SidebarSection>

        {/* Catalog panel */}
        <CatalogPanel catalog={catalog} setCatalog={setCatalog} />
      </div>
    </div>
  );
}

/** Returns a HSL color based on equipment category */
function getCategoryColor(category: string): string {
  const cat = category?.toLowerCase() || "";
  if (cat.includes("arcade") || cat.includes("borne")) return "hsl(280, 70%, 50%)";
  if (cat.includes("billard")) return "hsl(140, 60%, 40%)";
  if (cat.includes("bar") || cat.includes("comptoir")) return "hsl(30, 70%, 45%)";
  if (cat.includes("flipper") || cat.includes("pinball")) return "hsl(200, 70%, 50%)";
  if (cat.includes("mobilier") || cat.includes("table") || cat.includes("chaise")) return "hsl(50, 50%, 45%)";
  return "hsl(210, 40%, 55%)";
}
