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
               // Center and fit all rooms in view
               if (state.rooms.length > 0) {
                 const allPts = state.rooms.flatMap((r) => r.points);
                 const minX = Math.min(...allPts.map((p) => p.x));
                 const maxX = Math.max(...allPts.map((p) => p.x));
                 const minY = Math.min(...allPts.map((p) => p.y));
                 const maxY = Math.max(...allPts.map((p) => p.y));
                 
                 // Calculate plan dimensions in cm
                 const planWidth = maxX - minX;
                 const planHeight = maxY - minY;
                 const padding = 50; // 50cm padding around plan
                 
                 // Get viewport size (excluding toolbar)
                 const vw = window.innerWidth - 100; // Account for toolbar width
                 const vh = window.innerHeight;
                 
                 // Calculate zoom to fit plan with padding
                 const CM_TO_PX = 2;
                 const zoomX = vw / ((planWidth + padding * 2) * CM_TO_PX);
                 const zoomY = vh / ((planHeight + padding * 2) * CM_TO_PX);
                 const newZoom = Math.min(zoomX, zoomY, 1); // Don't zoom beyond 100%
                 
                 // Calculate center position
                 const cx = ((minX + maxX) / 2) * CM_TO_PX;
                 const cy = ((minY + maxY) / 2) * CM_TO_PX;
                 const px = vw / 2 - cx * newZoom;
                 const py = vh / 2 - cy * newZoom;
                 
                 dispatch({ type: "SET_ZOOM", zoom: newZoom });
                 dispatch({ type: "SET_PAN", offset: { x: px, y: py } });
               } else {
                 dispatch({ type: "SET_ZOOM", zoom: 1 });
                 dispatch({ type: "SET_PAN", offset: { x: window.innerWidth / 3, y: window.innerHeight / 3 } });
               }
             }}
           >
             <Locate className="h-5 w-5" />
           </Button>
         </TooltipTrigger>
         <TooltipContent side="right">Recentrer la vue</TooltipContent>
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
