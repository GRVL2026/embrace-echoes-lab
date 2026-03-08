import React, { useRef, useEffect, useCallback, useState } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { CM_TO_PX, type Point, type Door, type Pillar, type CirculationSegment } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";
import { DoorDialog } from "./DoorDialog";
import { PillarDialog } from "./PillarDialog";
import { computeCirculation } from "@/lib/circulation";

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, dispatch } = useEditor();
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState<Point>({ x: 0, y: 0 });
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const screenMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Auto-pan when drawing walls and mouse is near canvas edges
  const AUTO_PAN_EDGE = 60; // px from edge to trigger
  const AUTO_PAN_SPEED = 8; // px per frame
  const autoPanRef = useRef<number | null>(null);

  useEffect(() => {
    const isDrawing = drawingPoints.length > 0 && state.tool === "wall";
    if (!isDrawing) {
      if (autoPanRef.current) {
        cancelAnimationFrame(autoPanRef.current);
        autoPanRef.current = null;
      }
      return;
    }

    const tick = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mx = screenMouseRef.current.x;
      const my = screenMouseRef.current.y;

      let dx = 0, dy = 0;
      if (mx < rect.left + AUTO_PAN_EDGE) dx = AUTO_PAN_SPEED;
      else if (mx > rect.right - AUTO_PAN_EDGE) dx = -AUTO_PAN_SPEED;
      if (my < rect.top + AUTO_PAN_EDGE) dy = AUTO_PAN_SPEED;
      else if (my > rect.bottom - AUTO_PAN_EDGE) dy = -AUTO_PAN_SPEED;

      if (dx !== 0 || dy !== 0) {
        dispatch({
          type: "SET_PAN",
          offset: {
            x: state.panOffset.x + dx,
            y: state.panOffset.y + dy,
          },
        });
      }

      autoPanRef.current = requestAnimationFrame(tick);
    };

    autoPanRef.current = requestAnimationFrame(tick);
    return () => {
      if (autoPanRef.current) {
        cancelAnimationFrame(autoPanRef.current);
        autoPanRef.current = null;
      }
    };
  }, [drawingPoints.length > 0, state.tool, state.panOffset, dispatch]);
  const [hoveredWall, setHoveredWall] = useState<{ roomId: string; edgeIndex: number } | null>(null);
  const [draggingDoor, setDraggingDoor] = useState<string | null>(null);
  const [pendingDoorClick, setPendingDoorClick] = useState<{ doorId: string; startX: number; startY: number } | null>(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [draggingVertex, setDraggingVertex] = useState<{ roomId: string; pointIndex: number } | null>(null);
  const [pendingVertexClick, setPendingVertexClick] = useState<{ roomId: string; pointIndex: number; startX: number; startY: number } | null>(null);
  const [draggingPillar, setDraggingPillar] = useState<string | null>(null);
  const [rotatingPillar, setRotatingPillar] = useState<string | null>(null);
  const [pendingPillarClick, setPendingPillarClick] = useState<{ pillarId: string; startX: number; startY: number } | null>(null);
  const [hasPillarDragged, setHasPillarDragged] = useState(false);
  const [hoveredPillar, setHoveredPillar] = useState<string | null>(null);
  const [hasVertexDragged, setHasVertexDragged] = useState(false);
  // Equipment drag & rotate state
  const [draggingEquipment, setDraggingEquipment] = useState<string | null>(null);
  const [rotatingEquipment, setRotatingEquipment] = useState<string | null>(null);
  const [pendingEquipClick, setPendingEquipClick] = useState<{ equipId: string; startX: number; startY: number } | null>(null);
  const [hasEquipDragged, setHasEquipDragged] = useState(false);
  const [hoveredEquipment, setHoveredEquipment] = useState<string | null>(null);
  const [collidingEquipIds, setCollidingEquipIds] = useState<Set<string>>(new Set());
  const [editingDimension, setEditingDimension] = useState<{
    roomId: string;
    edgeIndex: number;
    screenX: number;
    screenY: number;
    currentValue: number; // in cm
  } | null>(null);
  const dimensionInputRef = useRef<HTMLInputElement>(null);

  // Door dialog state
  const [doorDialog, setDoorDialog] = useState<{
    open: boolean;
    roomId: string;
    edgeIndex: number;
    wallLength: number;
    editingDoorId?: string;
  } | null>(null);

  // Pillar dialog state
  const [pillarDialog, setPillarDialog] = useState<{
    open: boolean;
    pillarId: string;
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

  // Find pillar under a world point (includes rotation handle zone for hovered pillar)
  const findPillarAtPoint = useCallback((world: Point, includeHandle = false): Pillar | null => {
    for (const pillar of state.pillars) {
      const dx = world.x - pillar.position.x;
      const dy = world.y - pillar.position.y;
      // Un-rotate the point into the pillar's local space
      const rad = -(pillar.rotation || 0) * Math.PI / 180;
      const cosR = Math.cos(rad), sinR = Math.sin(rad);
      const lx = dx * cosR - dy * sinR;
      const ly = dx * sinR + dy * cosR;

      if (pillar.shape === "round") {
        const r = pillar.width / 2 + 5;
        if (lx * lx + ly * ly <= r * r) return pillar;
      } else {
        const hw = pillar.width / 2 + 5;
        const hd = pillar.depth / 2 + 5;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hd) return pillar;
      }

      // Also check rotation handle zone (so hover persists when moving to handle)
      if (includeHandle) {
        const handleDistCm = pillar.shape === "round"
          ? (pillar.width / 2 + 20 / state.zoom)
          : (Math.max(pillar.width, pillar.depth) / 2 + 20 / state.zoom);
        // Handle is at (0, -handleDistCm) in local space
        const hdx = lx;
        const hdy = ly + handleDistCm;
        if (hdx * hdx + hdy * hdy < (14 / state.zoom) * (14 / state.zoom)) return pillar;
        // Also check the stem line between pillar and handle
        if (Math.abs(lx) < 5 / state.zoom && ly < 0 && ly > -handleDistCm) return pillar;
      }
    }
    return null;
  }, [state.pillars, state.zoom]);

  // Check if world point is on a pillar's rotation handle
  const isOnRotationHandle = useCallback((world: Point, pillar: Pillar, zoom: number): boolean => {
    const handleDistCm = pillar.shape === "round"
      ? (pillar.width / 2 + 20 / zoom)
      : (Math.max(pillar.width, pillar.depth) / 2 + 20 / zoom);
    const rad = (pillar.rotation || 0) * Math.PI / 180;
    // Handle is at (0, -handleDistCm) in local space, rotated
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rotX = handleDistCm * sinR; // 0*cos - (-h)*sin = h*sin
    const rotY = -handleDistCm * cosR; // 0*sin + (-h)*cos = -h*cos
    const hx = pillar.position.x + rotX;
    const hy = pillar.position.y + rotY;
    const dx = world.x - hx;
    const dy = world.y - hy;
    return dx * dx + dy * dy < (12 / zoom) * (12 / zoom);
  }, []);

  // Find placed equipment under a world point
  const findEquipmentAtPoint = useCallback((world: Point, includeHandle = false): PlacedEquipment | null => {
    for (const eq of state.placedEquipments) {
      const dx = world.x - eq.position.x;
      const dy = world.y - eq.position.y;
      const rad = -(eq.rotation || 0) * Math.PI / 180;
      const cosR = Math.cos(rad), sinR = Math.sin(rad);
      const lx = dx * cosR - dy * sinR;
      const ly = dx * sinR + dy * cosR;
      const hw = eq.width / 2 + 5;
      const hd = eq.depth / 2 + 5;
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hd) return eq;

      // Check rotation handle zone
      if (includeHandle) {
        const handleDistCm = Math.max(eq.width, eq.depth) / 2 + 25 / state.zoom;
        const hdx = lx;
        const hdy = ly + handleDistCm;
        if (hdx * hdx + hdy * hdy < (14 / state.zoom) * (14 / state.zoom)) return eq;
        if (Math.abs(lx) < 5 / state.zoom && ly < 0 && ly > -handleDistCm) return eq;
      }
    }
    return null;
  }, [state.placedEquipments, state.zoom]);

  // Check if world point is on an equipment's rotation handle
  const isOnEquipmentRotationHandle = useCallback((world: Point, eq: PlacedEquipment, zoom: number): boolean => {
    const handleDistCm = Math.max(eq.width, eq.depth) / 2 + 25 / zoom;
    const rad = (eq.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rotX = handleDistCm * sinR;
    const rotY = -handleDistCm * cosR;
    const hx = eq.position.x + rotX;
    const hy = eq.position.y + rotY;
    const ddx = world.x - hx;
    const ddy = world.y - hy;
    return ddx * ddx + ddy * ddy < (12 / zoom) * (12 / zoom);
  }, []);

  // Check if a placed equipment collides with walls, pillars, doors, or other equipment
  const checkEquipmentCollision = useCallback((eqId: string): boolean => {
    const eq = state.placedEquipments.find(e => e.id === eqId);
    if (!eq) return false;
    const rad = (eq.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    // Get the 4 corners of the equipment in world space
    const hw = eq.width / 2, hd = eq.depth / 2;
    const corners = [
      { x: -hw, y: -hd }, { x: hw, y: -hd },
      { x: hw, y: hd }, { x: -hw, y: hd },
    ].map(c => ({
      x: eq.position.x + c.x * Math.cos(rad) - c.y * Math.sin(rad),
      y: eq.position.y + c.x * Math.sin(rad) + c.y * Math.cos(rad),
    }));

    // Helper: get axes for SAT from polygon corners
    const getAxes = (pts: { x: number; y: number }[]) => {
      const axes: { x: number; y: number }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const next = pts[(i + 1) % pts.length];
        const edge = { x: next.x - pts[i].x, y: next.y - pts[i].y };
        const len = Math.sqrt(edge.x * edge.x + edge.y * edge.y);
        if (len > 0) axes.push({ x: -edge.y / len, y: edge.x / len });
      }
      return axes;
    };

    const project = (pts: { x: number; y: number }[], axis: { x: number; y: number }) => {
      let min = Infinity, max = -Infinity;
      for (const p of pts) {
        const d = p.x * axis.x + p.y * axis.y;
        if (d < min) min = d;
        if (d > max) max = d;
      }
      return { min, max };
    };

    const satOverlap = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => {
      const axes = [...getAxes(a), ...getAxes(b)];
      for (const axis of axes) {
        const pa = project(a, axis), pb = project(b, axis);
        if (pa.max < pb.min || pb.max < pa.min) return false;
      }
      return true;
    };

    // Point-to-segment distance
    const ptSegDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const projX = ax + t * dx, projY = ay + t * dy;
      return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
    };

    // Check collision with walls (line segments)
    for (const room of state.rooms) {
      const edgeCount = room.isClosed ? room.points.length : room.points.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const a = room.points[i], b = room.points[(i + 1) % room.points.length];
        // Check if any corner is very close to wall or if wall segment intersects equipment
        // Use a thin rectangle around the wall segment for SAT
        const wdx = b.x - a.x, wdy = b.y - a.y;
        const wlen = Math.sqrt(wdx * wdx + wdy * wdy);
        if (wlen === 0) continue;
        const thickness = 5; // wall thickness in cm
        const nx = -wdy / wlen * thickness, ny = wdx / wlen * thickness;
        const wallRect = [
          { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
          { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
        ];
        if (satOverlap(corners, wallRect)) return true;
      }
    }

    // Check collision with pillars
    for (const pillar of state.pillars) {
      if (pillar.shape === "round") {
        // Circle vs OBB: check distance from circle center to closest point on OBB
        const dx = pillar.position.x - eq.position.x;
        const dy = pillar.position.y - eq.position.y;
        const lx = dx * cosR + dy * sinR;
        const ly = -dx * sinR + dy * cosR;
        const clampX = Math.max(-hw, Math.min(hw, lx));
        const clampY = Math.max(-hd, Math.min(hd, ly));
        const distSq = (lx - clampX) ** 2 + (ly - clampY) ** 2;
        if (distSq < (pillar.width / 2) ** 2) return true;
      } else {
        const pRad = (pillar.rotation || 0) * Math.PI / 180;
        const phw = pillar.width / 2, phd = pillar.depth / 2;
        const pillarCorners = [
          { x: -phw, y: -phd }, { x: phw, y: -phd },
          { x: phw, y: phd }, { x: -phw, y: phd },
        ].map(c => ({
          x: pillar.position.x + c.x * Math.cos(pRad) - c.y * Math.sin(pRad),
          y: pillar.position.y + c.x * Math.sin(pRad) + c.y * Math.cos(pRad),
        }));
        if (satOverlap(corners, pillarCorners)) return true;
      }
    }

    // Check collision with other equipment
    for (const other of state.placedEquipments) {
      if (other.id === eqId) continue;
      const oRad = (other.rotation || 0) * Math.PI / 180;
      const ohw = other.width / 2, ohd = other.depth / 2;
      const otherCorners = [
        { x: -ohw, y: -ohd }, { x: ohw, y: -ohd },
        { x: ohw, y: ohd }, { x: -ohw, y: ohd },
      ].map(c => ({
        x: other.position.x + c.x * Math.cos(oRad) - c.y * Math.sin(oRad),
        y: other.position.y + c.x * Math.sin(oRad) + c.y * Math.cos(oRad),
      }));
      if (satOverlap(corners, otherCorners)) return true;
    }

    // Check collision with door exclusion zones
    for (const door of state.doors) {
      const room = state.rooms.find(r => r.id === door.roomId);
      if (!room || door.edgeIndex >= room.points.length) continue;
      const a = room.points[door.edgeIndex];
      const b = room.points[(door.edgeIndex + 1) % room.points.length];
      const wdx = b.x - a.x, wdy = b.y - a.y;
      const wlen = Math.sqrt(wdx * wdx + wdy * wdy);
      if (wlen === 0) continue;
      const ux = wdx / wlen, uy = wdy / wlen;
      const cx = a.x + ux * door.positionRatio * wlen;
      const cy = a.y + uy * door.positionRatio * wlen;
      const doorHW = door.width / 2;
      // Door exclusion zone: rectangle in front of door
      const nx = -uy, ny = ux; // normal to wall
      const depth = 150; // exclusion depth in cm
      const doorRect = [
        { x: cx - ux * doorHW + nx * depth, y: cy - uy * doorHW + ny * depth },
        { x: cx + ux * doorHW + nx * depth, y: cy + uy * doorHW + ny * depth },
        { x: cx + ux * doorHW - nx * depth, y: cy + uy * doorHW - ny * depth },
        { x: cx - ux * doorHW - nx * depth, y: cy - uy * doorHW - ny * depth },
      ];
      if (satOverlap(corners, doorRect)) return true;
    }

    return false;
  }, [state.placedEquipments, state.rooms, state.pillars, state.doors]);

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
        if (room.isClosed) {
          ctx.closePath();
          ctx.fillStyle = "hsla(263, 85%, 68%, 0.05)";
          ctx.fill();
        }
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
          const edgeCount = room.isClosed ? room.points.length : room.points.length - 1;
          for (let i = 0; i < edgeCount; i++) {
            const p = room.points[i];
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
          }
        }

        // Draw vertices
        room.points.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x * CM_TO_PX, p.y * CM_TO_PX, 4 / state.zoom, 0, Math.PI * 2);
          ctx.fillStyle = "hsl(75, 100%, 50%)";
          ctx.fill();
        });

        // Draw angles at vertices (only for closed rooms or interior vertices of open polylines)
        if (state.showAngles && room.points.length >= 3) {
          const startIdx = room.isClosed ? 0 : 1;
          const endIdx = room.isClosed ? room.points.length : room.points.length - 1;
          for (let i = startIdx; i < endIdx; i++) {
            const p = room.points[i];
            const prev = room.points[(i - 1 + room.points.length) % room.points.length];
            const next = room.points[(i + 1) % room.points.length];
            const v1x = prev.x - p.x, v1y = prev.y - p.y;
            const v2x = next.x - p.x, v2y = next.y - p.y;
            const dot = v1x * v2x + v1y * v2y;
            const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
            if (len1 === 0 || len2 === 0) continue;
            const cosA = Math.max(-1, Math.min(1, dot / (len1 * len2)));
            const angleDeg = Math.round(Math.acos(cosA) * (180 / Math.PI));

            const arcR = 20 / state.zoom * CM_TO_PX;
            const a1 = Math.atan2(v1y, v1x);
            const a2 = Math.atan2(v2y, v2x);
            ctx.beginPath();
            ctx.arc(p.x * CM_TO_PX, p.y * CM_TO_PX, arcR, a1, a2, false);
            ctx.strokeStyle = "hsla(30, 100%, 60%, 0.6)";
            ctx.lineWidth = 1.5 / state.zoom;
            ctx.stroke();

            const bisectX = (v1x / len1 + v2x / len2);
            const bisectY = (v1y / len1 + v2y / len2);
            const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY) || 1;
            const labelDist = 30 / state.zoom;
            const lx = (p.x + bisectX / bisectLen * labelDist) * CM_TO_PX;
            const ly = (p.y + bisectY / bisectLen * labelDist) * CM_TO_PX;
            ctx.font = `bold ${10 / state.zoom}px Inter`;
            ctx.fillStyle = "hsl(30, 100%, 60%)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${angleDeg}°`, lx, ly);
          }
        }
      });

      // Draw doors
      drawDoors(ctx, state);

      // Draw pillars
      drawPillars(ctx, state, hoveredPillar);

      // Draw pillar-to-wall distances
      if (state.showPillarDistances && state.pillars.length > 0 && state.rooms.length > 0) {
        drawPillarDistances(ctx, state);
      }

      // Draw circulation path (before equipment so it's behind)
      if (state.showCirculation && state.circulationPath && state.circulationPath.length > 0) {
        drawCirculationPath(ctx, state.circulationPath, state.zoom);
      }

      // Compute collision set for placed equipments
      const collisionSet = new Set<string>();
      if (draggingEquipment || rotatingEquipment) {
        const checkId = draggingEquipment || rotatingEquipment;
        if (checkId && checkEquipmentCollision(checkId)) {
          collisionSet.add(checkId);
        }
      }

      // Draw placed equipments
      if (state.placedEquipments.length > 0) {
        drawPlacedEquipments(ctx, state.placedEquipments, state.zoom, hoveredEquipment, collisionSet);
      }

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

        // Snap indicator near last point (validate/stop drawing)
        if (drawingPoints.length >= 2) {
          const last = drawingPoints[drawingPoints.length - 1];
          const dToLast = Math.sqrt(
            (snapped.x - last.x) ** 2 + (snapped.y - last.y) ** 2
          );
          if (dToLast < 30) {
            ctx.beginPath();
            ctx.arc(last.x * CM_TO_PX, last.y * CM_TO_PX, 10 / state.zoom, 0, Math.PI * 2);
            ctx.strokeStyle = "hsl(120, 80%, 50%)";
            ctx.lineWidth = 2 / state.zoom;
            ctx.stroke();
          }
        }

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
  const findNearestEdge = useCallback((point: Point, polygon: Point[], threshold: number, isClosed = true): number => {
    let bestDist = Infinity;
    let bestIdx = -1;
    const edgeCount = isClosed ? polygon.length : polygon.length - 1;
    for (let i = 0; i < edgeCount; i++) {
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

  // Find if clicking on a dimension label
  const findDimensionAtPoint = useCallback((screenX: number, screenY: number): { roomId: string; edgeIndex: number; screenX: number; screenY: number; currentValue: number } | null => {
    const world = screenToWorld(screenX, screenY);
    const threshold = 15 / state.zoom;
    for (const room of state.rooms) {
      const edgeCount = room.isClosed ? room.points.length : room.points.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const p = room.points[i];
        const next = room.points[(i + 1) % room.points.length];
        const dx = next.x - p.x, dy = next.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (p.x + next.x) / 2;
        const midY = (p.y + next.y) / 2;
        const angle = Math.atan2(dy, dx);
        const offsetDist = 18 / state.zoom;
        const labelX = midX + Math.sin(angle) * offsetDist;
        const labelY = midY - Math.cos(angle) * offsetDist;
        const dToLabel = Math.sqrt((world.x - labelX) ** 2 + (world.y - labelY) ** 2);
        if (dToLabel < threshold) {
          // Convert label position to screen coords
          const canvas = canvasRef.current;
          if (!canvas) continue;
          const rect = canvas.getBoundingClientRect();
          const sx = labelX * CM_TO_PX * state.zoom + state.panOffset.x + rect.left;
          const sy = labelY * CM_TO_PX * state.zoom + state.panOffset.y + rect.top;
          return { roomId: room.id, edgeIndex: i, screenX: sx, screenY: sy, currentValue: dist };
        }
      }
    }
    return null;
  }, [state.rooms, state.zoom, state.panOffset, screenToWorld]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && state.tool === "pan")) {
      setIsPanning(true);
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }

    // Check if clicking on a dimension label (any tool)
    if (e.button === 0 && state.showDimensions && !editingDimension) {
      const dim = findDimensionAtPoint(e.clientX, e.clientY);
      if (dim) {
        setEditingDimension(dim);
        setTimeout(() => dimensionInputRef.current?.focus(), 0);
        return;
      }
    }

    // Check if clicking on a pillar with select tool → pending (click=dialog, drag=move)
    if (e.button === 0 && state.tool === "select") {
      const world = screenToWorld(e.clientX, e.clientY);
      const clickedPillar = findPillarAtPoint(world, true);
      if (clickedPillar) {
        // Check if clicking on rotation handle
        if (isOnRotationHandle(world, clickedPillar, state.zoom)) {
          setRotatingPillar(clickedPillar.id);
          return;
        }
        setPendingPillarClick({ pillarId: clickedPillar.id, startX: e.clientX, startY: e.clientY });
        setHasPillarDragged(false);
        return;
      }

      // Check if clicking on placed equipment
      const clickedEquip = findEquipmentAtPoint(world, true);
      if (clickedEquip) {
        if (isOnEquipmentRotationHandle(world, clickedEquip, state.zoom)) {
          setRotatingEquipment(clickedEquip.id);
          return;
        }
        setPendingEquipClick({ equipId: clickedEquip.id, startX: e.clientX, startY: e.clientY });
        setHasEquipDragged(false);
        return;
      }
    }

    // Check if clicking on a vertex — select/door: immediate drag; wall tool: pending (click=resume, hold+move=drag)
    if (e.button === 0 && (state.tool === "select" || state.tool === "door" || state.tool === "wall")) {
      const world = screenToWorld(e.clientX, e.clientY);
      const vertexThreshold = 10 / state.zoom;
      for (const room of state.rooms) {
        for (let i = 0; i < room.points.length; i++) {
          const p = room.points[i];
          const dist = Math.sqrt((world.x - p.x) ** 2 + (world.y - p.y) ** 2);
          if (dist < vertexThreshold) {
            if (state.tool === "wall" && drawingPoints.length === 0) {
              // Pending: wait to see if user drags or just clicks
              setPendingVertexClick({ roomId: room.id, pointIndex: i, startX: e.clientX, startY: e.clientY });
              setHasVertexDragged(false);
              return;
            }
            setDraggingVertex({ roomId: room.id, pointIndex: i });
            return;
          }
        }
      }
    }

    // Check if clicking on an existing door (any tool except eraser) — prepare for click or drag
    if (e.button === 0 && state.tool !== "eraser") {
      const world = screenToWorld(e.clientX, e.clientY);
      const clickedDoor = findDoorAtPoint(world);
      if (clickedDoor) {
        setPendingDoorClick({ doorId: clickedDoor.id, startX: e.clientX, startY: e.clientY });
        setHasDragged(false);
        return;
      }
    }

    if (state.tool === "eraser" && e.button === 0) {
      // Check equipment first
      if (hoveredEquipment) {
        dispatch({ type: "DELETE_PLACED_EQUIPMENT", id: hoveredEquipment });
        setHoveredEquipment(null);
        return;
      }
      // Check pillar
      if (hoveredPillar) {
        dispatch({ type: "DELETE_PILLAR", id: hoveredPillar });
        setHoveredPillar(null);
        return;
      }
      if (hoveredWall) {
        dispatch({ type: "DELETE_WALL", roomId: hoveredWall.roomId, edgeIndex: hoveredWall.edgeIndex });
        setHoveredWall(null);
      }
      return;
    }

    // Pillar tool: place or interact with pillar
    if (state.tool === "pillar" && e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY);
      const snapped = snapPoint(world);
      const clickedPillar = findPillarAtPoint(world, true);
      if (clickedPillar) {
        if (isOnRotationHandle(world, clickedPillar, state.zoom)) {
          setRotatingPillar(clickedPillar.id);
          return;
        }
        setPendingPillarClick({ pillarId: clickedPillar.id, startX: e.clientX, startY: e.clientY });
        setHasPillarDragged(false);
        return;
      }
      const pillar: Pillar = {
        id: crypto.randomUUID(),
        position: snapped,
        shape: "square",
        width: 30,
        depth: 30,
        height: 250,
        rotation: 0,
      };
      dispatch({ type: "ADD_PILLAR", pillar });
      setPillarDialog({ open: true, pillarId: pillar.id });
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
      const vertexThreshold = 15; // in cm

      // If we have points, check if clicking near the LAST drawing point → validate & stop
      if (drawingPoints.length >= 2) {
        const last = drawingPoints[drawingPoints.length - 1];
        const distToLast = Math.sqrt((snapped.x - last.x) ** 2 + (snapped.y - last.y) ** 2);
        if (distToLast < 30) {
          const id = crypto.randomUUID();
          dispatch({
            type: "ADD_ROOM",
            room: {
              id,
              points: [...drawingPoints],
              walls: [],
              name: `Mur ${state.rooms.length + 1}`,
              isClosed: false,
            },
          });
          setDrawingPoints([]);
          return;
        }
      }

      // Check if clicking near the FIRST drawing point (3+ points) → close polygon
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
              isClosed: true,
            },
          });
          setDrawingPoints([]);
          return;
        }
      }

      // If currently drawing, check if clicking on ANY existing room vertex → connect to it & validate
      if (drawingPoints.length >= 1) {
        for (const room of state.rooms) {
          for (let i = 0; i < room.points.length; i++) {
            const p = room.points[i];
            const dist = Math.sqrt((snapped.x - p.x) ** 2 + (snapped.y - p.y) ** 2);
            if (dist < vertexThreshold) {
              // Connect: add this point to drawing, then save
              const finalPoints = [...drawingPoints, p];
              const id = crypto.randomUUID();
              dispatch({
                type: "ADD_ROOM",
                room: {
                  id,
                  points: finalPoints,
                  walls: [],
                  name: `Mur ${state.rooms.length + 1}`,
                  isClosed: false,
                },
              });
              setDrawingPoints([]);
              return;
            }
          }
        }
      }

      setDrawingPoints((prev) => [...prev, snapped]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    screenMouseRef.current = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(e.clientX, e.clientY);
    setMousePos(world);

    // Handle vertex dragging
    if (draggingVertex) {
      const snapped = snapPoint(world);
      const room = state.rooms.find((r) => r.id === draggingVertex.roomId);
      if (room) {
        const newPoints = [...room.points];
        newPoints[draggingVertex.pointIndex] = snapped;
        dispatch({ type: "UPDATE_ROOM", id: draggingVertex.roomId, room: { points: newPoints } });
      }
      return;
    }

    // Handle pending vertex click → detect drag threshold
    if (pendingVertexClick && !draggingVertex) {
      const dx = e.clientX - pendingVertexClick.startX;
      const dy = e.clientY - pendingVertexClick.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        setDraggingVertex({ roomId: pendingVertexClick.roomId, pointIndex: pendingVertexClick.pointIndex });
        setHasVertexDragged(true);
      }
    }

    // Handle pending door click → detect drag threshold
    if (pendingDoorClick && !draggingDoor) {
      const dx = e.clientX - pendingDoorClick.startX;
      const dy = e.clientY - pendingDoorClick.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        setDraggingDoor(pendingDoorClick.doorId);
        setHasDragged(true);
      }
    }

    // Handle pending pillar click → detect drag threshold
    if (pendingPillarClick && !draggingPillar) {
      const dx = e.clientX - pendingPillarClick.startX;
      const dy = e.clientY - pendingPillarClick.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        setDraggingPillar(pendingPillarClick.pillarId);
        setHasPillarDragged(true);
      }
    }

    // Handle pending equipment click → detect drag threshold
    if (pendingEquipClick && !draggingEquipment) {
      const dx = e.clientX - pendingEquipClick.startX;
      const dy = e.clientY - pendingEquipClick.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        setDraggingEquipment(pendingEquipClick.equipId);
        setHasEquipDragged(true);
      }
    }

    // Handle door dragging
    if (draggingDoor) {
      const door = state.doors.find((d) => d.id === draggingDoor);
      if (door) {
        const room = state.rooms.find((r) => r.id === door.roomId);
        if (room && door.edgeIndex < room.points.length) {
          const a = room.points[door.edgeIndex];
          const b = room.points[(door.edgeIndex + 1) % room.points.length];
          const ddx = b.x - a.x, ddy = b.y - a.y;
          const wallLen = Math.sqrt(ddx * ddx + ddy * ddy);
          if (wallLen > 0) {
            const ux = ddx / wallLen, uy = ddy / wallLen;
            const proj = (world.x - a.x) * ux + (world.y - a.y) * uy;
            const halfW = door.width / 2;
            const clampedRatio = Math.max(halfW / wallLen, Math.min(1 - halfW / wallLen, proj / wallLen));
            dispatch({ type: "UPDATE_DOOR", id: draggingDoor, door: { positionRatio: clampedRatio } });
          }
        }
      }
      return;
    }

    // Handle pillar dragging
    if (draggingPillar) {
      const snapped = snapPoint(world);
      dispatch({ type: "UPDATE_PILLAR", id: draggingPillar, pillar: { position: snapped } });
      return;
    }

    // Handle equipment dragging
    if (draggingEquipment) {
      const snapped = snapPoint(world);
      dispatch({ type: "UPDATE_PLACED_EQUIPMENT", id: draggingEquipment, equipment: { position: snapped } });
      return;
    }

    // Handle equipment rotation
    if (rotatingEquipment) {
      const eq = state.placedEquipments.find((e) => e.id === rotatingEquipment);
      if (eq) {
        const angle = Math.atan2(world.x - eq.position.x, -(world.y - eq.position.y));
        let degrees = angle * 180 / Math.PI;
        if (state.snapToGrid) {
          degrees = Math.round(degrees / 15) * 15;
        }
        dispatch({ type: "UPDATE_PLACED_EQUIPMENT", id: rotatingEquipment, equipment: { rotation: degrees } });
      }
      return;
    }

    // Handle pillar rotation
    if (rotatingPillar) {
      const pillar = state.pillars.find((p) => p.id === rotatingPillar);
      if (pillar) {
        const angle = Math.atan2(world.x - pillar.position.x, -(world.y - pillar.position.y));
        let degrees = angle * 180 / Math.PI;
        // Snap to 15° increments if grid snap is on
        if (state.snapToGrid) {
          degrees = Math.round(degrees / 15) * 15;
        }
        dispatch({ type: "UPDATE_PILLAR", id: rotatingPillar, pillar: { rotation: degrees } });
      }
      return;
    }

    // Hover detection for eraser and door tools
    if (state.tool === "eraser" || state.tool === "door") {
      const threshold = 15 / state.zoom;
      let found: { roomId: string; edgeIndex: number } | null = null;
      for (const room of state.rooms) {
        const idx = findNearestEdge(world, room.points, threshold, room.isClosed);
        if (idx >= 0) {
          found = { roomId: room.id, edgeIndex: idx };
          break;
        }
      }
      setHoveredWall(found);
    } else if (hoveredWall) {
      setHoveredWall(null);
    }

    // Hover detection for pillars (eraser + pillar tool + select) — include handle zone
    if (state.tool === "eraser" || state.tool === "pillar" || state.tool === "select") {
      const p = findPillarAtPoint(world, true);
      setHoveredPillar(p ? p.id : null);
    } else if (hoveredPillar) {
      setHoveredPillar(null);
    }

    // Hover detection for placed equipment (select tool)
    if (state.tool === "select" || state.tool === "eraser") {
      const eq = findEquipmentAtPoint(world, true);
      setHoveredEquipment(eq ? eq.id : null);
    } else if (hoveredEquipment) {
      setHoveredEquipment(null);
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

    // If we had a pending door click and didn't drag → open settings
    if (pendingDoorClick && !hasDragged) {
      const door = state.doors.find((d) => d.id === pendingDoorClick.doorId);
      if (door) {
        const room = state.rooms.find((r) => r.id === door.roomId);
        if (room && door.edgeIndex < room.points.length) {
          const a = room.points[door.edgeIndex];
          const b = room.points[(door.edgeIndex + 1) % room.points.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const wallLength = Math.sqrt(dx * dx + dy * dy);
          setDoorDialog({
            open: true,
            roomId: door.roomId,
            edgeIndex: door.edgeIndex,
            wallLength,
            editingDoorId: door.id,
          });
        }
      }
    }

    // If we had a pending vertex click and didn't drag → resume drawing from that point
    if (pendingVertexClick && !hasVertexDragged) {
      const room = state.rooms.find((r) => r.id === pendingVertexClick.roomId);
      if (room && room.points.length >= 2) {
        const idx = pendingVertexClick.pointIndex;
        const isFirst = idx === 0;
        const isLast = idx === room.points.length - 1;
        if (isLast) {
          setDrawingPoints([...room.points]);
          dispatch({ type: "DELETE_ROOM", id: room.id });
        } else if (isFirst) {
          setDrawingPoints([...room.points].reverse());
          dispatch({ type: "DELETE_ROOM", id: room.id });
        } else {
          // Interior point: split into two parts
          // Part 1: points[0..idx] → save as a room
          // Part 2: points[idx..end] reversed → becomes drawingPoints (resume from idx)
          const part1 = room.points.slice(0, idx + 1);
          const part2 = room.points.slice(idx);
          // Save part1 as a new open room if it has at least 2 points
          if (part1.length >= 2) {
            dispatch({
              type: "ADD_ROOM",
              room: {
                id: crypto.randomUUID(),
                points: part1,
                walls: [],
                name: room.name,
                isClosed: false,
              },
            });
          }
          // Delete original room
          dispatch({ type: "DELETE_ROOM", id: room.id });
          // Resume drawing from part2 (keep order so we continue from the end)
          setDrawingPoints(part2);
        }
      }
    }
    // If we had a pending pillar click and didn't drag → open dialog
    if (pendingPillarClick && !hasPillarDragged) {
      setPillarDialog({ open: true, pillarId: pendingPillarClick.pillarId });
    }
    // If we had a pending equipment click and didn't drag → delete with eraser, or just deselect
    if (pendingEquipClick && !hasEquipDragged) {
      if (state.tool === "eraser") {
        dispatch({ type: "DELETE_PLACED_EQUIPMENT", id: pendingEquipClick.equipId });
      }
      // For select tool, clicking without drag does nothing special (could open dialog later)
    }

    setPendingVertexClick(null);
    setHasVertexDragged(false);
    setPendingDoorClick(null);
    setHasDragged(false);
    setPendingPillarClick(null);
    setHasPillarDragged(false);
    setPendingEquipClick(null);
    setHasEquipDragged(false);
    if (draggingVertex) setDraggingVertex(null);
    if (draggingDoor) setDraggingDoor(null);
    if (draggingPillar) setDraggingPillar(null);
    if (rotatingPillar) setRotatingPillar(null);
    if (draggingEquipment) {
      setDraggingEquipment(null);
      // Recompute circulation after equipment move
      const circ = computeCirculation(state.rooms, state.doors, state.pillars, state.placedEquipments);
      dispatch({ type: "SET_CIRCULATION", circulation: circ });
    }
    if (rotatingEquipment) {
      setRotatingEquipment(null);
      // Recompute circulation after equipment rotate
      const circ = computeCirculation(state.rooms, state.doors, state.pillars, state.placedEquipments);
      dispatch({ type: "SET_CIRCULATION", circulation: circ });
    }
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

  // Dimension edit handler
  const handleDimensionConfirm = (newValueCm: number) => {
    if (!editingDimension || newValueCm <= 0) {
      setEditingDimension(null);
      return;
    }
    const room = state.rooms.find((r) => r.id === editingDimension.roomId);
    if (!room) { setEditingDimension(null); return; }
    const i = editingDimension.edgeIndex;
    const p = room.points[i];
    const next = room.points[(i + 1) % room.points.length];
    const dx = next.x - p.x, dy = next.y - p.y;
    const oldLen = Math.sqrt(dx * dx + dy * dy);
    if (oldLen === 0) { setEditingDimension(null); return; }
    const scale = newValueCm / oldLen;
    const newNext = { x: p.x + dx * scale, y: p.y + dy * scale };
    const snapped = snapPoint(newNext);
    const newPoints = [...room.points];
    newPoints[(i + 1) % room.points.length] = snapped;
    dispatch({ type: "UPDATE_ROOM", id: room.id, room: { points: newPoints } });
    setEditingDimension(null);
  };

  // Door dialog handlers
  const handleDoorConfirm = (result: { width: number; positionRatio: number; openDirection: Door["openDirection"]; openDirectionRight?: Door["openDirection"]; openSide: Door["openSide"]; leafCount: Door["leafCount"] }) => {
    if (!doorDialog) return;
    if (doorDialog.editingDoorId) {
      // Update existing door
      dispatch({
        type: "UPDATE_DOOR",
        id: doorDialog.editingDoorId,
        door: {
          width: result.width,
          positionRatio: result.positionRatio,
          openDirection: result.openDirection,
          openDirectionRight: result.openDirectionRight,
          openSide: result.openSide,
          leafCount: result.leafCount,
        },
      });
    } else {
      // Create new door
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
    }
    setDoorDialog(null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        dispatch({ type: "UNDO" });
        return;
      }
      switch (e.key.toLowerCase()) {
        case "v": dispatch({ type: "SET_TOOL", tool: "select" }); break;
        case "w": dispatch({ type: "SET_TOOL", tool: "wall" }); break;
        case "d": dispatch({ type: "SET_TOOL", tool: "door" }); break;
        case "p": dispatch({ type: "SET_TOOL", tool: "pillar" }); break;
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
    rotatingPillar || rotatingEquipment
      ? "cursor-alias"
      : draggingVertex || draggingDoor || draggingPillar || draggingEquipment
      ? "cursor-grabbing"
      : state.tool === "pan" || isPanning
      ? "cursor-grab"
      : state.tool === "wall"
      ? "cursor-crosshair"
      : state.tool === "eraser"
      ? ""
      : state.tool === "door"
      ? "cursor-pointer"
      : state.tool === "pillar"
      ? "cursor-crosshair"
      : (hoveredEquipment || hoveredPillar)
      ? "cursor-grab"
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
      {state.tool === "pillar" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card/80 backdrop-blur-sm px-4 py-2 text-sm text-muted-foreground neon-border">
          Cliquez pour placer un poteau. Glissez un poteau existant pour le déplacer.
        </div>
      )}

      {editingDimension && (
        <div
          className="absolute z-50"
          style={{
            left: editingDimension.screenX - (containerRef.current?.getBoundingClientRect().left ?? 0) - 40,
            top: editingDimension.screenY - (containerRef.current?.getBoundingClientRect().top ?? 0) - 16,
          }}
        >
          <input
            ref={dimensionInputRef}
            type="text"
            defaultValue={editingDimension.currentValue >= 100
              ? (editingDimension.currentValue / 100).toFixed(2)
              : Math.round(editingDimension.currentValue).toString()
            }
            className="w-20 rounded border border-primary bg-card px-2 py-0.5 text-xs text-primary text-center font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const raw = (e.target as HTMLInputElement).value.trim();
                let cm: number;
                if (raw.endsWith("m") && !raw.endsWith("cm")) {
                  cm = parseFloat(raw) * 100;
                } else if (raw.endsWith("cm")) {
                  cm = parseFloat(raw);
                } else {
                  // If current was shown in meters, interpret as meters; else cm
                  const val = parseFloat(raw);
                  cm = editingDimension.currentValue >= 100 ? val * 100 : val;
                }
                if (!isNaN(cm) && cm > 0) handleDimensionConfirm(cm);
                else setEditingDimension(null);
              } else if (e.key === "Escape") {
                setEditingDimension(null);
              }
            }}
            onBlur={() => setEditingDimension(null)}
          />
        </div>
      )}

      {/* Door dialog */}
      {doorDialog && (
        <DoorDialog
          open={doorDialog.open}
          wallLength={doorDialog.wallLength}
          initialValues={doorDialog.editingDoorId ? state.doors.find((d) => d.id === doorDialog.editingDoorId) : undefined}
          onConfirm={handleDoorConfirm}
          onCancel={() => setDoorDialog(null)}
        />
      )}

      {/* Pillar dialog */}
      {pillarDialog && (() => {
        const p = state.pillars.find((pl) => pl.id === pillarDialog.pillarId);
        if (!p) return null;
        return (
          <PillarDialog
            open={pillarDialog.open}
            pillar={p}
            onConfirm={(updates) => {
              dispatch({ type: "UPDATE_PILLAR", id: p.id, pillar: updates });
              setPillarDialog(null);
            }}
            onDelete={() => {
              dispatch({ type: "DELETE_PILLAR", id: p.id });
              setPillarDialog(null);
            }}
            onCancel={() => setPillarDialog(null)}
          />
        );
      })()}
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

// Draw pillars
function drawPillars(
  ctx: CanvasRenderingContext2D,
  state: { pillars: Pillar[]; zoom: number; showDimensions?: boolean },
  hoveredPillarId: string | null
) {
  const { pillars, zoom } = state;

  pillars.forEach((pillar) => {
    const cx = pillar.position.x * CM_TO_PX;
    const cy = pillar.position.y * CM_TO_PX;
    const isHovered = pillar.id === hoveredPillarId;
    const rad = (pillar.rotation || 0) * Math.PI / 180;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);

    if (pillar.shape === "round") {
      const r = (pillar.width / 2) * CM_TO_PX;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? "hsla(30, 80%, 50%, 0.3)" : "hsla(30, 60%, 40%, 0.2)";
      ctx.fill();
      ctx.strokeStyle = isHovered ? "hsl(0, 85%, 60%)" : "hsl(30, 80%, 50%)";
      ctx.lineWidth = 2 / zoom;
      ctx.stroke();

      // Cross pattern
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.6);
      ctx.lineTo(r * 0.6, r * 0.6);
      ctx.moveTo(r * 0.6, -r * 0.6);
      ctx.lineTo(-r * 0.6, r * 0.6);
      ctx.strokeStyle = isHovered ? "hsla(0, 85%, 60%, 0.5)" : "hsla(30, 80%, 50%, 0.4)";
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    } else {
      const hw = (pillar.width / 2) * CM_TO_PX;
      const hd = (pillar.depth / 2) * CM_TO_PX;
      ctx.fillStyle = isHovered ? "hsla(30, 80%, 50%, 0.3)" : "hsla(30, 60%, 40%, 0.2)";
      ctx.fillRect(-hw, -hd, hw * 2, hd * 2);
      ctx.strokeStyle = isHovered ? "hsl(0, 85%, 60%)" : "hsl(30, 80%, 50%)";
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(-hw, -hd, hw * 2, hd * 2);

      // Cross pattern
      ctx.beginPath();
      ctx.moveTo(-hw, -hd);
      ctx.lineTo(hw, hd);
      ctx.moveTo(hw, -hd);
      ctx.lineTo(-hw, hd);
      ctx.strokeStyle = isHovered ? "hsla(0, 85%, 60%, 0.5)" : "hsla(30, 80%, 50%, 0.4)";
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    // Dimension label (below pillar)
    if (state.showDimensions) {
      const label = pillar.shape === "round"
        ? `Ø${pillar.width}cm`
        : `${pillar.width}×${pillar.depth}cm`;
      ctx.font = `${10 / zoom}px Inter`;
      ctx.fillStyle = "hsl(30, 80%, 50%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const yOffset = pillar.shape === "round"
        ? (pillar.width / 2) * CM_TO_PX + 6 / zoom
        : (pillar.depth / 2) * CM_TO_PX + 6 / zoom;
      ctx.fillText(label, 0, yOffset);
    }

    // Rotation handle (above pillar, connected by a line)
    if (isHovered) {
      const handleDist = pillar.shape === "round"
        ? (pillar.width / 2) * CM_TO_PX + 20 / zoom
        : (Math.max(pillar.width, pillar.depth) / 2) * CM_TO_PX + 20 / zoom;
      
      // Line from top of pillar to handle
      ctx.beginPath();
      ctx.moveTo(0, -(pillar.shape === "round" ? (pillar.width / 2) * CM_TO_PX : (pillar.depth / 2) * CM_TO_PX));
      ctx.lineTo(0, -handleDist);
      ctx.strokeStyle = "hsla(263, 85%, 68%, 0.6)";
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();

      // Handle circle
      ctx.beginPath();
      ctx.arc(0, -handleDist, 6 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = "hsl(263, 85%, 68%)";
      ctx.fill();
      ctx.strokeStyle = "hsl(263, 85%, 90%)";
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();

      // Rotation arrow icon inside handle
      ctx.beginPath();
      const r = 3.5 / zoom;
      ctx.arc(0, -handleDist, r, -Math.PI * 0.7, Math.PI * 0.5);
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.2 / zoom;
      ctx.stroke();
      // Arrow tip
      const tipAngle = Math.PI * 0.5;
      const tipX = Math.cos(tipAngle) * r;
      const tipY = -handleDist + Math.sin(tipAngle) * r;
      ctx.beginPath();
      ctx.moveTo(tipX - 2 / zoom, tipY - 1.5 / zoom);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX + 1.5 / zoom, tipY - 2 / zoom);
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.2 / zoom;
      ctx.stroke();
    }

    // Rotation angle label
    if (isHovered && pillar.rotation && Math.abs(pillar.rotation) > 0.5) {
      ctx.font = `bold ${9 / zoom}px Inter`;
      ctx.fillStyle = "hsl(263, 85%, 68%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const labelY = pillar.shape === "round"
        ? -(pillar.width / 2) * CM_TO_PX - 28 / zoom
        : -(Math.max(pillar.width, pillar.depth) / 2) * CM_TO_PX - 28 / zoom;
      ctx.fillText(`${Math.round(pillar.rotation)}°`, 0, labelY);
    }

    ctx.restore();
  });
}

// Draw distances from each pillar to nearest walls
function drawPillarDistances(
  ctx: CanvasRenderingContext2D,
  state: { pillars: Pillar[]; rooms: { id: string; points: Point[]; isClosed: boolean }[]; zoom: number }
) {
  const { pillars, rooms, zoom } = state;

  // Collect all wall edges
  const edges: { ax: number; ay: number; bx: number; by: number }[] = [];
  rooms.forEach((room) => {
    const count = room.isClosed ? room.points.length : room.points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = room.points[i];
      const b = room.points[(i + 1) % room.points.length];
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  });

  if (edges.length === 0) return;

  pillars.forEach((pillar) => {
    const px = pillar.position.x;
    const py = pillar.position.y;
    const rot = (pillar.rotation || 0) * Math.PI / 180;

    // Compute pillar edge point closest to a given direction
    function pillarEdgePoint(dirX: number, dirY: number): { ex: number; ey: number } {
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len === 0) return { ex: px, ey: py };
      const ndx = dirX / len, ndy = dirY / len;

      if (pillar.shape === "round") {
        const radius = pillar.width / 2;
        return { ex: px + ndx * radius, ey: py + ndy * radius };
      }

      // Rectangular: transform direction into pillar local space (unrotate)
      const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
      const ldx = ndx * cosR - ndy * sinR;
      const ldy = ndx * sinR + ndy * cosR;

      const hw = pillar.width / 2, hd = pillar.depth / 2;
      // Ray-box intersection from center in local space
      let tMin = Infinity;
      if (Math.abs(ldx) > 1e-9) {
        const t = (ldx > 0 ? hw : -hw) / ldx;
        if (t > 0) tMin = Math.min(tMin, t);
      }
      if (Math.abs(ldy) > 1e-9) {
        const t = (ldy > 0 ? hd : -hd) / ldy;
        if (t > 0) tMin = Math.min(tMin, t);
      }
      if (!isFinite(tMin)) return { ex: px, ey: py };
      return { ex: px + ndx * tMin, ey: py + ndy * tMin };
    }

    // Find closest point on each edge, keep the 4 nearest
    const distances: { dist: number; projX: number; projY: number; edgeX: number; edgeY: number }[] = [];

    edges.forEach((e) => {
      const dx = e.bx - e.ax, dy = e.by - e.ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return;
      const t = Math.max(0, Math.min(1, ((px - e.ax) * dx + (py - e.ay) * dy) / len2));
      const projX = e.ax + t * dx;
      const projY = e.ay + t * dy;
      // Direction from pillar center to wall projection
      const dirX = projX - px, dirY = projY - py;
      const { ex, ey } = pillarEdgePoint(dirX, dirY);
      const dist = Math.sqrt((ex - projX) ** 2 + (ey - projY) ** 2);
      distances.push({ dist, projX, projY, edgeX: ex, edgeY: ey });
    });

    distances.sort((a, b) => a.dist - b.dist);

    // Draw the 4 closest distances (or fewer)
    const toDraw = distances.slice(0, 4);
    // Filter out duplicates (same projection point within 1cm)
    const unique: typeof toDraw = [];
    toDraw.forEach((d) => {
      const isDup = unique.some(
        (u) => Math.abs(u.projX - d.projX) < 1 && Math.abs(u.projY - d.projY) < 1
      );
      if (!isDup) unique.push(d);
    });

    unique.forEach((d) => {
      const ecx = d.edgeX * CM_TO_PX;
      const ecy = d.edgeY * CM_TO_PX;
      const wpx = d.projX * CM_TO_PX;
      const wpy = d.projY * CM_TO_PX;

      // Dashed line from pillar edge to wall
      ctx.beginPath();
      ctx.moveTo(ecx, ecy);
      ctx.lineTo(wpx, wpy);
      ctx.strokeStyle = "hsla(180, 70%, 50%, 0.5)";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distance label at midpoint
      const mx = (ecx + wpx) / 2;
      const my = (ecy + wpy) / 2;
      const label = d.dist >= 100
        ? `${(d.dist / 100).toFixed(2)}m`
        : `${Math.round(d.dist)}cm`;

      ctx.save();
      const angle = Math.atan2(wpy - ecy, wpx - ecx);
      const textAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;
      const offX = Math.sin(angle) * (10 / zoom);
      const offY = -Math.cos(angle) * (10 / zoom);
      ctx.translate(mx + offX, my + offY);
      ctx.rotate(textAngle);
      ctx.font = `bold ${9 / zoom}px Inter`;
      ctx.fillStyle = "hsl(180, 70%, 50%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, 0, -1 / zoom);
      ctx.restore();
    });
  });
}

// Draw placed equipments on the canvas
function drawPlacedEquipments(
  ctx: CanvasRenderingContext2D,
  equipments: PlacedEquipment[],
  zoom: number,
  hoveredEquipId?: string | null,
  collidingIds?: Set<string>,
) {
  equipments.forEach((eq) => {
    const cx = eq.position.x * CM_TO_PX;
    const cy = eq.position.y * CM_TO_PX;
    const w = eq.width * CM_TO_PX;
    const d = eq.depth * CM_TO_PX;
    const rot = (eq.rotation || 0) * Math.PI / 180;
    const isHovered = eq.id === hoveredEquipId;
    const isColliding = collidingIds?.has(eq.id) ?? false;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Safety zone (dashed outline)
    const szW = (eq.width + eq.safetyZone * 2) * CM_TO_PX;
    const szD = (eq.depth + eq.safetyZone * 2) * CM_TO_PX;
    ctx.strokeStyle = isColliding ? "hsla(0, 85%, 60%, 0.4)" : "hsla(48, 100%, 50%, 0.25)";
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(-szW / 2, -szD / 2, szW, szD);
    ctx.setLineDash([]);

    // Equipment body
    const bodyColor = isColliding ? "hsl(0, 85%, 60%)" : eq.color;
    const bodyFill = isColliding ? "hsla(0, 85%, 60%, 0.3)" : eq.color.replace(")", ", 0.3)").replace("hsl(", "hsla(");
    ctx.fillStyle = bodyFill;
    ctx.fillRect(-w / 2, -d / 2, w, d);
    ctx.strokeStyle = isColliding ? "hsl(0, 85%, 60%)" : (isHovered ? "hsl(48, 100%, 70%)" : eq.color);
    ctx.lineWidth = isColliding ? 3 / zoom : (isHovered ? 3 / zoom : 2 / zoom);
    ctx.strokeRect(-w / 2, -d / 2, w, d);

    // Label
    ctx.fillStyle = isColliding ? "hsl(0, 85%, 60%)" : eq.color;
    ctx.font = `bold ${Math.max(10, 11 / zoom)}px Inter`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxChars = Math.floor(w / (7 / zoom * CM_TO_PX) * 2);
    const label = eq.name.length > maxChars ? eq.name.slice(0, maxChars - 1) + "…" : eq.name;
    ctx.fillText(label, 0, 0);

    // Dimensions below
    ctx.font = `${9 / zoom}px Inter`;
    ctx.fillStyle = "hsla(48, 100%, 50%, 0.7)";
    ctx.fillText(`${eq.width}×${eq.depth}cm`, 0, d / 2 + 12 / zoom);

    // Rotation handle (when hovered)
    if (isHovered) {
      const handleDistPx = Math.max(eq.width, eq.depth) / 2 * CM_TO_PX + 25 / zoom;
      // Stem line
      ctx.beginPath();
      ctx.moveTo(0, -d / 2);
      ctx.lineTo(0, -handleDistPx);
      ctx.strokeStyle = "hsla(48, 100%, 60%, 0.6)";
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([3 / zoom, 3 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Handle circle
      ctx.beginPath();
      ctx.arc(0, -handleDistPx, 6 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = "hsl(48, 100%, 60%)";
      ctx.fill();
      ctx.strokeStyle = "hsl(240, 60%, 4.7%)";
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();

      // Rotation icon
      ctx.beginPath();
      ctx.arc(0, -handleDistPx, 3.5 / zoom, -Math.PI * 0.7, Math.PI * 0.7);
      ctx.strokeStyle = "hsl(240, 60%, 4.7%)";
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    ctx.restore();
  });
}

// Draw circulation path (safety corridors)
function drawCirculationPath(
  ctx: CanvasRenderingContext2D,
  segments: CirculationSegment[],
  zoom: number,
) {
  if (segments.length === 0) return;
  
  // Draw corridor fill (semi-transparent green)
  ctx.fillStyle = "hsla(142, 70%, 45%, 0.15)";
  ctx.strokeStyle = "hsla(142, 70%, 45%, 0.6)";
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([8 / zoom, 4 / zoom]);
  
  segments.forEach((seg) => {
    const startX = seg.start.x * CM_TO_PX;
    const startY = seg.start.y * CM_TO_PX;
    const endX = seg.end.x * CM_TO_PX;
    const endY = seg.end.y * CM_TO_PX;
    const width = seg.width * CM_TO_PX;
    
    // Calculate perpendicular offset for corridor width
    const dx = endX - startX;
    const dy = endY - startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    
    const nx = -dy / len; // perpendicular
    const ny = dx / len;
    const hw = width / 2;
    
    // Draw corridor as a rectangle
    ctx.beginPath();
    ctx.moveTo(startX + nx * hw, startY + ny * hw);
    ctx.lineTo(endX + nx * hw, endY + ny * hw);
    ctx.lineTo(endX - nx * hw, endY - ny * hw);
    ctx.lineTo(startX - nx * hw, startY - ny * hw);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  
  ctx.setLineDash([]);
  
  // Draw "1.40m" label in the center of the first segment
  if (segments.length > 0) {
    const seg = segments[0];
    const midX = ((seg.start.x + seg.end.x) / 2) * CM_TO_PX;
    const midY = ((seg.start.y + seg.end.y) / 2) * CM_TO_PX;
    
    ctx.save();
    ctx.fillStyle = "hsla(142, 70%, 35%, 0.9)";
    ctx.font = `bold ${12 / zoom}px Inter`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // Background for label
    const text = "Circulation 1.40m";
    const textMetrics = ctx.measureText(text);
    const padding = 6 / zoom;
    ctx.fillStyle = "hsla(142, 70%, 95%, 0.9)";
    ctx.fillRect(
      midX - textMetrics.width / 2 - padding,
      midY - 8 / zoom - padding,
      textMetrics.width + padding * 2,
      16 / zoom + padding * 2
    );
    
    ctx.fillStyle = "hsla(142, 70%, 30%, 1)";
    ctx.fillText(text, midX, midY);
    ctx.restore();
  }
}
