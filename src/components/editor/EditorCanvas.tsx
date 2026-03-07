import React, { useRef, useEffect, useCallback, useState } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { CM_TO_PX, type Point } from "@/types/editor";

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, dispatch } = useEditor();
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState<Point>({ x: 0, y: 0 });
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [hoveredWall, setHoveredWall] = useState<{ roomId: string; edgeIndex: number } | null>(null);

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
            // Large perpendicular offset to place label beside the wall
            const offsetDist = 18 / state.zoom;
            const offsetX = Math.sin(angle) * offsetDist;
            const offsetY = -Math.cos(angle) * offsetDist;
            // Rotate text to follow wall direction
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

      // Draw current drawing
      if (drawingPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(drawingPoints[0].x * CM_TO_PX, drawingPoints[0].y * CM_TO_PX);
        drawingPoints.forEach((p, i) => {
          if (i > 0) ctx.lineTo(p.x * CM_TO_PX, p.y * CM_TO_PX);
        });
        // Line to current mouse
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

  // Check if point is inside a polygon (ray casting)
  const pointInPolygon = useCallback((point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }, []);

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

    if (state.tool === "eraser" && e.button === 0) {
      if (hoveredWall) {
        dispatch({ type: "DELETE_WALL", roomId: hoveredWall.roomId, edgeIndex: hoveredWall.edgeIndex });
        setHoveredWall(null);
      }
      return;
    }

    if (state.tool === "wall" && e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY);
      const snapped = snapPoint(world);

      // Check if closing the polygon
      if (drawingPoints.length >= 3) {
        const first = drawingPoints[0];
        const dist = Math.sqrt((snapped.x - first.x) ** 2 + (snapped.y - first.y) ** 2);
        if (dist < 30) {
          // Close and create room
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

    // Eraser hover detection
    if (state.tool === "eraser") {
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
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Only zoom on pinch (ctrlKey), pan on regular two-finger scroll
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

  const cursorClass =
    state.tool === "pan" || isPanning
      ? "cursor-grab"
      : state.tool === "wall"
      ? "cursor-crosshair"
      : "cursor-default";

  return (
    <div ref={containerRef} className={`relative flex-1 overflow-hidden ${cursorClass}`}>
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
      {/* Drawing hint */}
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
    </div>
  );
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

  // Visible area in world coords
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
