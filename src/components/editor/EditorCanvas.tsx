import React, { useRef, useEffect, useCallback, useState } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { CM_TO_PX, type Point, type Door } from "@/types/editor";
import { DoorDialog } from "./DoorDialog";

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, dispatch } = useEditor();
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState<Point>({ x: 0, y: 0 });
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [hoveredWall, setHoveredWall] = useState<{ roomId: string; edgeIndex: number } | null>(null);
  const [draggingDoor, setDraggingDoor] = useState<string | null>(null); // door id being dragged

  // Door dialog state
  const [doorDialog, setDoorDialog] = useState<{
    open: boolean;
    roomId: string;
    edgeIndex: number;
    wallLength: number;
  } | null>(null);

  // Find door under a world point
  const findDoorAtPoint = useCallback((world: Point): Door | null => {
    for (const door of state.doors) {
      const room = state.rooms.find((r) => r.id === door.roomId);
      if (!room || door.edgeIndex >= room.points.length) continue;
      const a = room.points[door.edgeIndex];
      const b = room.points[(door.edgeIndex + 1) % room.points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const wallLen = Math.sqrt(dx * dx + dy * dy);
      if (wallLen === 0) continue;
      const ux = dx / wallLen, uy = dy / wallLen;
      const centerDist = door.positionRatio * wallLen;
      const halfW = door.width / 2;
      // Project world point onto wall line
      const px = world.x - a.x, py = world.y - a.y;
      const proj = px * ux + py * uy; // distance along wall
      const perpDist = Math.abs(px * (-uy) + py * ux); // distance from wall
      if (proj >= centerDist - halfW && proj <= centerDist + halfW && perpDist < 15 / state.zoom) {
        return door;
      }
    }
    return null;
  }, [state.doors, state.rooms, state.zoom]);

  // Convert screen coords to world coords (cm)
  const screenToWorld = useCallback(
    (sx: number, sy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const x = (sx - rect.left - state.panOffset.x) / (state.zoom * CM_TO_PX);
      const y = (sy - rect.top - state.panOffset.y) / (state.zoom * CM_TO_PX);
      return { x, y };
    },
    [state.zoom, state.panOffset]
  );

  const snapPoint = useCallback(
    (p: Point): Point => {
      if (!state.snapToGrid) return p;
      const g = state.gridSize;
      return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    },
    [state.snapToGrid, state.gridSize]
  );

  // Resize canvas to container
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(state.panOffset.x, state.panOffset.y);
      ctx.scale(state.zoom, state.zoom);

      // Draw grid
      drawGrid(ctx, canvas.width, canvas.height, state);

      // Draw existing rooms
      state.rooms.forEach((room) => {
        if (room.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(room.points[0].x * CM_TO_PX, room.points[0].y * CM_TO_PX);
        room.points.forEach((p, i) => {
          if (i > 0) ctx.lineTo(p.x * CM_TO_PX, p.y * CM_TO_PX);
        });
        ctx.closePath();
        ctx.fillStyle = "hsla(263, 85%, 68%, 0.05)";
        ctx.fill();
        ctx.strokeStyle = "hsl(263, 85%, 68%)";
        ctx.lineWidth = 2 / state.zoom;
        ctx.stroke();

        // Highlight hovered wall for eraser or door tool
        if (hoveredWall && hoveredWall.roomId === room.id) {
          const a = room.points[hoveredWall.edgeIndex];
          const b = room.points[(hoveredWall.edgeIndex + 1) % room.points.length];
          ctx.beginPath();
          ctx.moveTo(a.x * CM_TO_PX, a.y * CM_TO_PX);
          ctx.lineTo(b.x * CM_TO_PX, b.y * CM_TO_PX);
          ctx.strokeStyle = state.tool === "eraser" ? "hsl(0, 85%, 60%)" : "hsl(200, 85%, 60%)";
          ctx.lineWidth = 4 / state.zoom;
          ctx.stroke();
        }

        // Draw wall dimensions
        if (state.showDimensions) {
          room.points.forEach((p, i) => {
            const next = room.points[(i + 1) % room.points.length];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const midX = ((p.x + next.x) / 2) * CM_TO_PX;
            const midY = ((p.y + next.y) / 2) * CM_TO_PX;
            ctx.save();
            const label = dist >= 100 ? `${(dist / 100).toFixed(2)}m` : `${Math.round(dist)}cm`;
            const angle = Math.atan2(dy, dx);
            const offsetDist = 18 / state.zoom;
            const offsetX = Math.sin(angle) * offsetDist;
            const offsetY = -Math.cos(angle) * offsetDist;
            ctx.translate(midX + offsetX, midY + offsetY);
            const textAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;
            ctx.rotate(textAngle);
            ctx.font = `${11 / state.zoom}px Inter`;
            ctx.fillStyle = "hsl(48, 100%, 50%)";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(label, 0, -2 / state.zoom);
            ctx.restore();
          });
        }

        // Draw vertices
        room.points.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x * CM_TO_PX, p.y * CM_TO_PX, 4 / state.zoom, 0, Math.PI * 2);
          ctx.fillStyle = "hsl(75, 100%, 50%)";
          ctx.fill();
        });
      });

      // Draw doors
      drawDoors(ctx, state);

      // Draw current drawing
      if (drawingPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(drawingPoints[0].x * CM_TO_PX, drawingPoints[0].y * CM_TO_PX);
        drawingPoints.forEach((p, i) => {
          if (i > 0) ctx.lineTo(p.x * CM_TO_PX, p.y * CM_TO_PX);
        });
        const snapped = snapPoint(mousePos);
        ctx.lineTo(snapped.x * CM_TO_PX, snapped.y * CM_TO_PX);
        ctx.strokeStyle = "hsl(75, 100%, 50%)";
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([6 / state.zoom, 4 / state.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw dimension for current segment
        if (state.showDimensions) {
          const lastP = drawingPoints[drawingPoints.length - 1];
          const dx = snapped.x - lastP.x;
          const dy = snapped.y - lastP.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 5) {
            const midX = ((lastP.x + snapped.x) / 2) * CM_TO_PX;
            const midY = ((lastP.y + snapped.y) / 2) * CM_TO_PX;
            const label = dist >= 100 ? `${(dist / 100).toFixed(2)}m` : `${Math.round(dist)}cm`;
            const angle = Math.atan2(dy, dx);
            const offsetDist = 18 / state.zoom;
            const oX = Math.sin(angle) * offsetDist;
            const oY = -Math.cos(angle) * offsetDist;
            ctx.save();
            ctx.translate(midX + oX, midY + oY);
            const textAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;
            ctx.rotate(textAngle);
            ctx.font = `bold ${13 / state.zoom}px Inter`;
            ctx.fillStyle = "hsl(75, 100%, 50%)";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(label, 0, -2 / state.zoom);
            ctx.restore();
          }
        }

        // Draw points
        drawingPoints.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x * CM_TO_PX, p.y * CM_TO_PX, 5 / state.zoom, 0, Math.PI * 2);
          ctx.fillStyle = "hsl(75, 100%, 50%)";
          ctx.fill();
          ctx.strokeStyle = "hsl(240, 60%, 4.7%)";
          ctx.lineWidth = 2 / state.zoom;
          ctx.stroke();
        });

        // Snap indicator near first point (close polygon)
        if (drawingPoints.length >= 3) {
          const first = drawingPoints[0];
          const dToFirst = Math.sqrt(
            (snapped.x - first.x) ** 2 + (snapped.y - first.y) ** 2
          );
          if (dToFirst < 30) {
            ctx.beginPath();
            ctx.arc(first.x * CM_TO_PX, first.y * CM_TO_PX, 10 / state.zoom, 0, Math.PI * 2);
            ctx.strokeStyle = "hsl(75, 100%, 50%)";
            ctx.lineWidth = 2 / state.zoom;
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    };

    draw();
  });

  // Find nearest edge index of a polygon (returns -1 if none within threshold)
  const findNearestEdge = useCallback((point: Point, polygon: Point[], threshold: number): number => {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (len * len)));
      const projX = a.x + t * dx, projY = a.y + t * dy;
      const dist = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, []);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && state.tool === "pan")) {
      setIsPanning(true);
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }

    // Check if clicking on an existing door (any tool except eraser) — start drag
    if (e.button === 0 && state.tool !== "eraser") {
      const world = screenToWorld(e.clientX, e.clientY);
      const clickedDoor = findDoorAtPoint(world);
      if (clickedDoor) {
        setDraggingDoor(clickedDoor.id);
        return;
      }
    }

    if (state.tool === "eraser" && e.button === 0) {
      if (hoveredWall) {
        dispatch({ type: "DELETE_WALL", roomId: hoveredWall.roomId, edgeIndex: hoveredWall.edgeIndex });
        setHoveredWall(null);
      }
      return;
    }

    if (state.tool === "door" && e.button === 0) {
      if (hoveredWall) {
        const room = state.rooms.find((r) => r.id === hoveredWall.roomId);
        if (room) {
          const a = room.points[hoveredWall.edgeIndex];
          const b = room.points[(hoveredWall.edgeIndex + 1) % room.points.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const wallLength = Math.sqrt(dx * dx + dy * dy);
          setDoorDialog({
            open: true,
            roomId: hoveredWall.roomId,
            edgeIndex: hoveredWall.edgeIndex,
            wallLength,
          });
        }
      }
      return;
    }

    if (state.tool === "wall" && e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY);
      const snapped = snapPoint(world);

      if (drawingPoints.length >= 3) {
        const first = drawingPoints[0];
        const dist = Math.sqrt((snapped.x - first.x) ** 2 + (snapped.y - first.y) ** 2);
        if (dist < 30) {
          const id = crypto.randomUUID();
          dispatch({
            type: "ADD_ROOM",
            room: {
              id,
              points: [...drawingPoints],
              walls: [],
              name: `Salle ${state.rooms.length + 1}`,
            },
          });
          setDrawingPoints([]);
          return;
        }
      }
      setDrawingPoints((prev) => [...prev, snapped]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const world = screenToWorld(e.clientX, e.clientY);
    setMousePos(world);

    // Handle door dragging
    if (draggingDoor) {
      const door = state.doors.find((d) => d.id === draggingDoor);
      if (door) {
        const room = state.rooms.find((r) => r.id === door.roomId);
        if (room && door.edgeIndex < room.points.length) {
          const a = room.points[door.edgeIndex];
          const b = room.points[(door.edgeIndex + 1) % room.points.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const wallLen = Math.sqrt(dx * dx + dy * dy);
          if (wallLen > 0) {
            const ux = dx / wallLen, uy = dy / wallLen;
            const proj = (world.x - a.x) * ux + (world.y - a.y) * uy;
            const halfW = door.width / 2;
            const clampedRatio = Math.max(halfW / wallLen, Math.min(1 - halfW / wallLen, proj / wallLen));
            dispatch({ type: "UPDATE_DOOR", id: draggingDoor, door: { positionRatio: clampedRatio } });
          }
        }
      }
      return;
    }


    // Hover detection for eraser and door tools
    if (state.tool === "eraser" || state.tool === "door") {
      const threshold = 15 / state.zoom;
      let found: { roomId: string; edgeIndex: number } | null = null;
      for (const room of state.rooms) {
        const idx = findNearestEdge(world, room.points, threshold);
        if (idx >= 0) {
          found = { roomId: room.id, edgeIndex: idx };
          break;
        }
      }
      setHoveredWall(found);
    } else if (hoveredWall) {
      setHoveredWall(null);
    }

    if (isPanning) {
      const dx = e.clientX - lastPanPos.x;
      const dy = e.clientY - lastPanPos.y;
      dispatch({
        type: "SET_PAN",
        offset: { x: state.panOffset.x + dx, y: state.panOffset.y + dy },
      });
      setLastPanPos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (draggingDoor) setDraggingDoor(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = state.zoom * delta;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const newPanX = mx - (mx - state.panOffset.x) * delta;
      const newPanY = my - (my - state.panOffset.y) * delta;

      dispatch({ type: "SET_ZOOM", zoom: newZoom });
      dispatch({ type: "SET_PAN", offset: { x: newPanX, y: newPanY } });
    } else {
      e.preventDefault();
      dispatch({
        type: "SET_PAN",
        offset: { x: state.panOffset.x - e.deltaX, y: state.panOffset.y - e.deltaY },
      });
    }
  };

  // Door dialog handlers
  const handleDoorConfirm = (result: { width: number; positionRatio: number; openDirection: Door["openDirection"]; openDirectionRight?: Door["openDirection"]; openSide: Door["openSide"]; leafCount: Door["leafCount"] }) => {
    if (!doorDialog) return;
    const door: Door = {
      id: crypto.randomUUID(),
      roomId: doorDialog.roomId,
      edgeIndex: doorDialog.edgeIndex,
      positionRatio: result.positionRatio,
      width: result.width,
      openDirection: result.openDirection,
      openDirectionRight: result.openDirectionRight,
      openSide: result.openSide,
      leafCount: result.leafCount,
    };
    dispatch({ type: "ADD_DOOR", door });
    setDoorDialog(null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key.toLowerCase()) {
        case "v": dispatch({ type: "SET_TOOL", tool: "select" }); break;
        case "w": dispatch({ type: "SET_TOOL", tool: "wall" }); break;
        case "d": dispatch({ type: "SET_TOOL", tool: "door" }); break;
        case "h": dispatch({ type: "SET_TOOL", tool: "pan" }); break;
        case "e": dispatch({ type: "SET_TOOL", tool: "eraser" }); break;
        case "escape": setDrawingPoints([]); break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dispatch]);

  const eraserCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23ff4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21'/%3E%3Cpath d='M22 21H7'/%3E%3Cpath d='m5 11 9 9'/%3E%3C/svg%3E") 4 20, auto`;

  const cursorStyle =
    draggingDoor
      ? "cursor-grabbing"
      : state.tool === "pan" || isPanning
      ? "cursor-grab"
      : state.tool === "wall"
      ? "cursor-crosshair"
      : state.tool === "eraser"
      ? ""
      : state.tool === "door"
      ? "cursor-pointer"
      : "cursor-default";

  const inlineCursor = state.tool === "eraser" && !isPanning ? { cursor: eraserCursor } : undefined;

  return (
    <div ref={containerRef} className={`relative flex-1 overflow-hidden ${cursorStyle}`} style={inlineCursor}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="absolute inset-0"
      />
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 rounded-md border border-border bg-card/80 backdrop-blur-sm px-3 py-1.5 text-xs font-display text-muted-foreground neon-border">
        {Math.round(state.zoom * 100)}%
      </div>
      {/* Coordinates */}
      <div className="absolute bottom-4 left-4 rounded-md border border-border bg-card/80 backdrop-blur-sm px-3 py-1.5 text-xs font-mono text-muted-foreground neon-border">
        {Math.round(mousePos.x)}cm × {Math.round(mousePos.y)}cm
      </div>
      {/* Drawing hints */}
      {state.tool === "wall" && drawingPoints.length === 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card/80 backdrop-blur-sm px-4 py-2 text-sm text-muted-foreground neon-border">
          Cliquez pour placer les points du mur. <kbd className="ml-1 text-primary">Échap</kbd> pour annuler.
        </div>
      )}
      {state.tool === "wall" && drawingPoints.length >= 3 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card/80 backdrop-blur-sm px-4 py-2 text-sm text-secondary neon-border">
          Cliquez près du premier point pour fermer la salle.
        </div>
      )}
      {state.tool === "door" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card/80 backdrop-blur-sm px-4 py-2 text-sm text-muted-foreground neon-border">
          Cliquez sur un mur pour ajouter une porte.
        </div>
      )}

      {/* Door dialog */}
      {doorDialog && (
        <DoorDialog
          open={doorDialog.open}
          wallLength={doorDialog.wallLength}
          onConfirm={handleDoorConfirm}
          onCancel={() => setDoorDialog(null)}
        />
      )}
    </div>
  );
}

// Draw doors with arc opening indicator
function drawDoors(
  ctx: CanvasRenderingContext2D,
  state: { rooms: { id: string; points: Point[] }[]; doors: Door[]; zoom: number; showDimensions?: boolean }
) {
  const { rooms, doors, zoom } = state;

  doors.forEach((door) => {
    const room = rooms.find((r) => r.id === door.roomId);
    if (!room || door.edgeIndex >= room.points.length) return;

    const a = room.points[door.edgeIndex];
    const b = room.points[(door.edgeIndex + 1) % room.points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen === 0) return;

    const ux = dx / wallLen, uy = dy / wallLen;
    // Perpendicular: left of wall direction = interior
    const nx = -uy, ny = ux;

    const centerDist = door.positionRatio * wallLen;
    const halfW = door.width / 2;
    const startDist = centerDist - halfW;
    const endDist = centerDist + halfW;

    const sx = (a.x + ux * startDist) * CM_TO_PX;
    const sy = (a.y + uy * startDist) * CM_TO_PX;
    const ex = (a.x + ux * endDist) * CM_TO_PX;
    const ey = (a.y + uy * endDist) * CM_TO_PX;

    ctx.save();

    // Clear wall segment
    ctx.strokeStyle = "hsl(240, 60%, 4.7%)";
    ctx.lineWidth = 4 / zoom;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Draw door line
    ctx.strokeStyle = "hsl(200, 85%, 60%)";
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Side multiplier: interior = left of wall dir (positive perp), exterior = opposite
    const sideMul = door.openSide === "interior" ? 1 : -1;
    const wallAngle = Math.atan2(dy, dx);

    if (door.leafCount === "single") {
      drawDoorArc(ctx, zoom, door.openDirection, wallAngle, sideMul, sx, sy, ex, ey, door.width);
    } else {
      // Double door: split at center
      const cx = (sx + ex) / 2;
      const cy = (sy + ey) / 2;
      // Left leaf: from sx,sy to cx,cy
      drawDoorArc(ctx, zoom, door.openDirection, wallAngle, sideMul, sx, sy, cx, cy, door.width / 2);
      // Right leaf: from cx,cy to ex,ey
      const rightDir = door.openDirectionRight || "right";
      drawDoorArc(ctx, zoom, rightDir, wallAngle, sideMul, cx, cy, ex, ey, door.width / 2);
    }

    // Draw dimension labels
    const wallAngleForText = wallAngle;
    const textAngle = wallAngleForText > Math.PI / 2 || wallAngleForText < -Math.PI / 2
      ? wallAngleForText + Math.PI : wallAngleForText;
    const labelOffset = 16 / zoom;
    const perpOffX = Math.sin(wallAngleForText) * labelOffset;
    const perpOffY = -Math.cos(wallAngleForText) * labelOffset;
    const formatDim = (cm: number) => cm >= 100 ? `${(cm / 100).toFixed(2)}m` : `${Math.round(cm)}cm`;

    // Left segment
    const leftLen = startDist;
    if (leftLen > 5) {
      const lmx = (a.x + ux * leftLen / 2) * CM_TO_PX;
      const lmy = (a.y + uy * leftLen / 2) * CM_TO_PX;
      ctx.save();
      ctx.translate(lmx + perpOffX, lmy + perpOffY);
      ctx.rotate(textAngle);
      ctx.font = `${10 / zoom}px Inter`;
      ctx.fillStyle = "hsl(48, 100%, 50%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(formatDim(leftLen), 0, -2 / zoom);
      ctx.restore();
    }

    // Door width label
    const dmx = (sx + ex) / 2;
    const dmy = (sy + ey) / 2;
    ctx.save();
    ctx.translate(dmx - perpOffX, dmy - perpOffY);
    ctx.rotate(textAngle);
    ctx.font = `bold ${10 / zoom}px Inter`;
    ctx.fillStyle = "hsl(200, 85%, 60%)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatDim(door.width), 0, 2 / zoom);
    ctx.restore();

    // Right segment
    const rightLen = wallLen - endDist;
    if (rightLen > 5) {
      const rmx = (a.x + ux * (endDist + rightLen / 2)) * CM_TO_PX;
      const rmy = (a.y + uy * (endDist + rightLen / 2)) * CM_TO_PX;
      ctx.save();
      ctx.translate(rmx + perpOffX, rmy + perpOffY);
      ctx.rotate(textAngle);
      ctx.font = `${10 / zoom}px Inter`;
      ctx.fillStyle = "hsl(48, 100%, 50%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(formatDim(rightLen), 0, -2 / zoom);
      ctx.restore();
    }

    ctx.restore();
  });
}

// Draw a single door leaf arc
function drawDoorArc(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  openDir: "left" | "right",
  wallAngle: number,
  sideMul: number, // 1 = interior (left of wall), -1 = exterior
  sx: number, sy: number, // leaf start
  ex: number, ey: number, // leaf end
  leafWidth: number,
) {
  const arcRadius = leafWidth * CM_TO_PX;
  // Hinge is on the side specified by openDir
  const hingePx = openDir === "left" ? { x: sx, y: sy } : { x: ex, y: ey };

  // Arc sweeps from wall direction into the perpendicular (interior or exterior)
  let startAngle: number, endAngle: number;
  const perpOffset = (Math.PI / 2) * sideMul;

  if (openDir === "left") {
    startAngle = wallAngle;
    endAngle = wallAngle - perpOffset;
  } else {
    startAngle = wallAngle + perpOffset;
    endAngle = wallAngle;
  }

  const counterClockwise = (openDir === "left") === (sideMul === 1);

  ctx.beginPath();
  ctx.arc(hingePx.x, hingePx.y, arcRadius, startAngle, endAngle, counterClockwise);
  ctx.strokeStyle = "hsla(200, 85%, 60%, 0.5)";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hinge dot
  ctx.beginPath();
  ctx.arc(hingePx.x, hingePx.y, 3 / zoom, 0, Math.PI * 2);
  ctx.fillStyle = "hsl(200, 85%, 60%)";
  ctx.fill();
}

// Draw the background grid
function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  state: { zoom: number; panOffset: Point; gridSize: number }
) {
  const { zoom, panOffset, gridSize } = state;
  const pxPerCell = gridSize * CM_TO_PX;

  const startX = Math.floor(-panOffset.x / (zoom * pxPerCell)) - 1;
  const startY = Math.floor(-panOffset.y / (zoom * pxPerCell)) - 1;
  const endX = Math.ceil((canvasWidth - panOffset.x) / (zoom * pxPerCell)) + 1;
  const endY = Math.ceil((canvasHeight - panOffset.y) / (zoom * pxPerCell)) + 1;

  // Minor grid
  ctx.strokeStyle = "hsla(240, 30%, 18%, 0.4)";
  ctx.lineWidth = 0.5 / zoom;
  for (let x = startX; x <= endX; x++) {
    ctx.beginPath();
    ctx.moveTo(x * pxPerCell, startY * pxPerCell);
    ctx.lineTo(x * pxPerCell, endY * pxPerCell);
    ctx.stroke();
  }
  for (let y = startY; y <= endY; y++) {
    ctx.beginPath();
    ctx.moveTo(startX * pxPerCell, y * pxPerCell);
    ctx.lineTo(endX * pxPerCell, y * pxPerCell);
    ctx.stroke();
  }

  // Major grid (every 100cm = 1m)
  const majorEvery = Math.ceil(100 / gridSize);
  ctx.strokeStyle = "hsla(240, 30%, 25%, 0.6)";
  ctx.lineWidth = 1 / zoom;
  for (let x = startX; x <= endX; x++) {
    if (x % majorEvery === 0) {
      ctx.beginPath();
      ctx.moveTo(x * pxPerCell, startY * pxPerCell);
      ctx.lineTo(x * pxPerCell, endY * pxPerCell);
      ctx.stroke();
    }
  }
  for (let y = startY; y <= endY; y++) {
    if (y % majorEvery === 0) {
      ctx.beginPath();
      ctx.moveTo(startX * pxPerCell, y * pxPerCell);
      ctx.lineTo(endX * pxPerCell, y * pxPerCell);
      ctx.stroke();
    }
  }

  // Axes
  ctx.strokeStyle = "hsla(263, 85%, 68%, 0.3)";
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.moveTo(0, startY * pxPerCell);
  ctx.lineTo(0, endY * pxPerCell);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(startX * pxPerCell, 0);
  ctx.lineTo(endX * pxPerCell, 0);
  ctx.stroke();

  // Meter labels on axes
  ctx.font = `${10 / zoom}px Inter`;
  ctx.fillStyle = "hsla(240, 10%, 55%, 0.8)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = startX; x <= endX; x++) {
    if (x % majorEvery === 0 && x !== 0) {
      const meters = (x * gridSize) / 100;
      ctx.fillText(`${meters}m`, x * pxPerCell, 4 / zoom);
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let y = startY; y <= endY; y++) {
    if (y % majorEvery === 0 && y !== 0) {
      const meters = (y * gridSize) / 100;
      ctx.fillText(`${meters}m`, 4 / zoom, y * pxPerCell);
    }
  }
}
