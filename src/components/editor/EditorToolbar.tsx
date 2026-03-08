import {
  MousePointer2,
  PenTool,
  DoorOpen,
  Hand,
  Eraser,
  Grid3X3,
  Ruler,
  ZoomIn,
  ZoomOut,
  Undo2,
  Locate,
  Triangle,
  Columns,
  Route,
  RotateCw,
  RotateCcw,
} from "lucide-react";
import { useEditor } from "@/contexts/EditorContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EditorTool } from "@/types/editor";

const tools: { id: EditorTool; label: string; icon: React.ElementType; shortcut: string }[] = [
  { id: "select", label: "Sélectionner", icon: MousePointer2, shortcut: "V" },
  { id: "wall", label: "Dessiner murs", icon: PenTool, shortcut: "W" },
  { id: "door", label: "Ajouter porte", icon: DoorOpen, shortcut: "D" },
  { id: "pillar", label: "Ajouter poteau", icon: Columns, shortcut: "P" },
  { id: "pan", label: "Déplacer vue", icon: Hand, shortcut: "H" },
  { id: "eraser", label: "Effacer", icon: Eraser, shortcut: "E" },
];

export function EditorToolbar() {
  const { state, dispatch, canUndo } = useEditor();

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card/80 backdrop-blur-sm p-2 neon-border">
      {tools.map((tool) => (
        <Tooltip key={tool.id} delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-10 w-10 transition-all",
                state.tool === tool.id && "bg-primary/20 text-primary glow-purple"
              )}
              onClick={() => dispatch({ type: "SET_TOOL", tool: tool.id })}
            >
              <tool.icon className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{tool.label} <kbd className="ml-1 text-xs text-muted-foreground">{tool.shortcut}</kbd></p>
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator className="my-1 w-6" />

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10", state.snapToGrid && "bg-secondary/20 text-secondary")}
            onClick={() => dispatch({ type: "TOGGLE_SNAP" })}
          >
            <Grid3X3 className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Snap grille</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10", state.showDimensions && "bg-accent/20 text-accent")}
            onClick={() => dispatch({ type: "TOGGLE_DIMENSIONS" })}
          >
            <Ruler className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Afficher dimensions</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10", state.showAngles && "bg-accent/20 text-accent")}
            onClick={() => dispatch({ type: "TOGGLE_ANGLES" })}
          >
            <Triangle className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Afficher angles</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10", state.showPillarDistances && "bg-accent/20 text-accent")}
            onClick={() => dispatch({ type: "TOGGLE_PILLAR_DISTANCES" })}
          >
            <Columns className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Distances murs-poteaux</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10", state.showCirculation && "bg-green-500/20 text-green-500")}
            onClick={() => dispatch({ type: "TOGGLE_CIRCULATION" })}
          >
            <Route className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Afficher circulation (1.40m)</TooltipContent>
      </Tooltip>

      {/* Scale toggle: m ↔ cm */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10 font-mono text-xs font-bold",
              state.gridSize === 1
                ? "bg-accent/20 text-accent"
                : "text-muted-foreground"
            )}
            onClick={() =>
              dispatch({
                type: "SET_GRID_SIZE",
                size: state.gridSize === 1 ? 20 : 1,
              })
            }
          >
            {state.gridSize === 1 ? "cm" : "m"}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {state.gridSize === 1
            ? "Échelle centimètre (1cm) — cliquer pour mètre"
            : "Échelle mètre (20cm) — cliquer pour centimètre"}
        </TooltipContent>
      </Tooltip>

      <Separator className="my-1 w-6" />

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() => dispatch({ type: "SET_ZOOM", zoom: state.zoom * 1.25 })}
          >
            <ZoomIn className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Zoom +</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() => dispatch({ type: "SET_ZOOM", zoom: state.zoom / 1.25 })}
          >
            <ZoomOut className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Zoom −</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
         <TooltipTrigger asChild>
           <Button
             variant="ghost"
             size="icon"
             className="h-10 w-10"
              onClick={() => {
                // Gather ALL points: rooms, pillars, placed equipment
                const allPts: { x: number; y: number }[] = [];
                state.rooms.forEach((r) => r.points.forEach((p) => allPts.push(p)));
                state.pillars.forEach((p) => {
                  const half = Math.max(p.width, p.depth) / 2;
                  allPts.push({ x: p.position.x - half, y: p.position.y - half });
                  allPts.push({ x: p.position.x + half, y: p.position.y + half });
                });
                state.placedEquipments.forEach((e) => {
                  const half = Math.max(e.width, e.depth) / 2 + e.safetyZone;
                  allPts.push({ x: e.position.x - half, y: e.position.y - half });
                  allPts.push({ x: e.position.x + half, y: e.position.y + half });
                });

                if (allPts.length > 0) {
                  const minX = Math.min(...allPts.map((p) => p.x));
                  const maxX = Math.max(...allPts.map((p) => p.x));
                  const minY = Math.min(...allPts.map((p) => p.y));
                  const maxY = Math.max(...allPts.map((p) => p.y));

                  const planWidth = maxX - minX;
                  const planHeight = maxY - minY;
                  const paddingCm = 100; // 1m padding

                  // Available viewport (subtract left toolbar ~60px + right sidebar ~288px, header ~56px)
                  const vw = window.innerWidth - 60 - 288;
                  const vh = window.innerHeight - 56;

                  const scale = 0.5; // CM_TO_PX
                  const zoomX = vw / ((planWidth + paddingCm * 2) * scale);
                  const zoomY = vh / ((planHeight + paddingCm * 2) * scale);
                  const newZoom = Math.min(zoomX, zoomY, 5);

                  const cx = ((minX + maxX) / 2) * scale;
                  const cy = ((minY + maxY) / 2) * scale;
                  const px = vw / 2 - cx * newZoom + 60;
                  const py = vh / 2 - cy * newZoom + 56;

                  dispatch({ type: "SET_ZOOM", zoom: newZoom });
                  dispatch({ type: "SET_PAN", offset: { x: px, y: py } });
                } else {
                  dispatch({ type: "SET_ZOOM", zoom: 1 });
                  dispatch({ type: "SET_PAN", offset: { x: window.innerWidth / 3, y: window.innerHeight / 3 } });
                }
              }
           >
             <Locate className="h-5 w-5" />
           </Button>
         </TooltipTrigger>
         <TooltipContent side="right">Recentrer la vue</TooltipContent>
       </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() => dispatch({ type: "ROTATE_PLAN", degrees: 90 })}
          >
            <RotateCw className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Pivoter 90° horaire</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() => dispatch({ type: "ROTATE_PLAN", degrees: -90 })}
          >
            <RotateCcw className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Pivoter 90° anti-horaire</TooltipContent>
      </Tooltip>

      <Separator className="my-1 w-6" />

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-destructive"
            disabled={!canUndo}
            onClick={() => dispatch({ type: "UNDO" })}
          >
            <Undo2 className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Annuler (Ctrl+Z)</TooltipContent>
      </Tooltip>
    </div>
  );
}
