/**
 * Standalone 2D plan renderer for PDF export.
 * Renders rooms, doors, pillars, equipment, gap measurements, and circulation path
 * onto an offscreen canvas with configurable visibility flags.
 * Output: clean technical drawing on a white background.
 */
import type { Room, Door, Pillar, Point, CirculationSegment } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";

export type Plan2DRenderOptions = {
  width?: number;            // canvas width in px
  height?: number;           // canvas height in px
  showGames?: boolean;       // draw placed equipments
  showGapMeasurements?: boolean; // draw dimensions between games / games & walls
  showCirculation?: boolean; // draw PMR circulation path
  showWallDimensions?: boolean; // draw wall lengths
  title?: string;
};

const COLORS = {
  bg: "#ffffff",
  wall: "#0f172a",
  wallFill: "#e2e8f0",
  door: "#9b5cff",
  pillar: "#475569",
  equipment: "#9b5cff",
  equipmentFill: "rgba(155, 92, 255, 0.18)",
  equipmentLabel: "#1e293b",
  dim: "#0ea5e9",
  dimText: "#0369a1",
  circulation: "#16a34a",
  circulationFill: "rgba(34, 197, 94, 0.30)",
  grid: "#f1f5f9",
  text: "#0f172a",
  muted: "#64748b",
};

function getBounds(rooms: Room[], equipments: PlacedEquipment[], pillars: Pillar[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  rooms.forEach((r) => r.points.forEach((p) => acc(p.x, p.y)));
  equipments.forEach((e) => {
    const r = Math.max(e.width, e.depth) / 2 + 10;
    acc(e.position.x - r, e.position.y - r);
    acc(e.position.x + r, e.position.y + r);
  });
  pillars.forEach((p) => {
    const r = Math.max(p.width, p.depth) / 2 + 5;
    acc(p.position.x - r, p.position.y - r);
    acc(p.position.x + r, p.position.y + r);
  });
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return { minX, minY, maxX, maxY };
}

function raySegmentIntersect(
  origin: Point, dir: Point, a: Point, b: Point,
): number | null {
  const v1x = origin.x - a.x, v1y = origin.y - a.y;
  const v2x = b.x - a.x, v2y = b.y - a.y;
  const v3x = -dir.y, v3y = dir.x;
  const dot = v2x * v3x + v2y * v3y;
  if (Math.abs(dot) < 1e-6) return null;
  const t1 = (v2x * v1y - v2y * v1x) / dot;
  const t2 = (v1x * v3x + v1y * v3y) / dot;
  if (t1 >= 0.01 && t2 >= 0 && t2 <= 1) return t1;
  return null;
}

export function renderPlan2D(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
  circulation: CirculationSegment[],
  options: Plan2DRenderOptions = {},
): string {
  const W = options.width ?? 1800;
  const H = options.height ?? 1200;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // White background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // Bounds & transform (fit to canvas)
  const showEq = options.showGames !== false;
  const visibleEq = showEq ? equipments : [];
  const b = getBounds(rooms, visibleEq, pillars);
  const planW = b.maxX - b.minX;
  const planH = b.maxY - b.minY;
  if (planW <= 0 || planH <= 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Plan vide", W / 2, H / 2);
    return canvas.toDataURL("image/png");
  }
  const padding = 80;
  const scale = Math.min((W - 2 * padding) / planW, (H - 2 * padding) / planH);
  const offsetX = (W - planW * scale) / 2 - b.minX * scale;
  const offsetY = (H - planH * scale) / 2 - b.minY * scale;
  const tx = (x: number) => x * scale + offsetX;
  const ty = (y: number) => y * scale + offsetY;
  const ts = (v: number) => v * scale;

  // Title
  if (options.title) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(options.title, 24, 36);
  }

  // Light grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const gridStep = 100; // cm
  const gx0 = Math.floor(b.minX / gridStep) * gridStep;
  const gy0 = Math.floor(b.minY / gridStep) * gridStep;
  for (let x = gx0; x <= b.maxX; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(tx(x), ty(b.minY));
    ctx.lineTo(tx(x), ty(b.maxY));
    ctx.stroke();
  }
  for (let y = gy0; y <= b.maxY; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(tx(b.minX), ty(y));
    ctx.lineTo(tx(b.maxX), ty(y));
    ctx.stroke();
  }

  // Floor fill
  rooms.forEach((room) => {
    if (!room.isClosed || room.points.length < 3) return;
    ctx.beginPath();
    room.points.forEach((p, i) => {
      const X = tx(p.x), Y = ty(p.y);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = COLORS.wallFill;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // Circulation path (under everything else but above floor)
  if (options.showCirculation && circulation.length > 0) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    circulation.forEach((seg) => {
      const corridorW = ts(seg.width || 120);
      ctx.strokeStyle = COLORS.circulationFill;
      ctx.lineWidth = corridorW;
      ctx.beginPath();
      ctx.moveTo(tx(seg.start.x), ty(seg.start.y));
      ctx.lineTo(tx(seg.end.x), ty(seg.end.y));
      ctx.stroke();
    });
    // Centerline
    ctx.strokeStyle = COLORS.circulation;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    circulation.forEach((seg) => {
      ctx.beginPath();
      ctx.moveTo(tx(seg.start.x), ty(seg.start.y));
      ctx.lineTo(tx(seg.end.x), ty(seg.end.y));
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // Walls
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 4;
  ctx.lineCap = "square";
  rooms.forEach((room) => {
    const n = room.isClosed ? room.points.length : room.points.length - 1;
    for (let i = 0; i < n; i++) {
      const a = room.points[i];
      const c = room.points[(i + 1) % room.points.length];

      // Find doors on this edge to leave gaps
      const edgeDoors = doors
        .filter((d) => d.roomId === room.id && d.edgeIndex === i)
        .sort((a, b) => a.positionRatio - b.positionRatio);

      const wallLen = Math.hypot(c.x - a.x, c.y - a.y);
      const ux = (c.x - a.x) / wallLen, uy = (c.y - a.y) / wallLen;

      let cursor = 0;
      edgeDoors.forEach((door) => {
        const centerDist = door.positionRatio * wallLen;
        const start = centerDist - door.width / 2;
        const end = centerDist + door.width / 2;
        if (start > cursor) {
          ctx.beginPath();
          ctx.moveTo(tx(a.x + ux * cursor), ty(a.y + uy * cursor));
          ctx.lineTo(tx(a.x + ux * start), ty(a.y + uy * start));
          ctx.stroke();
        }
        cursor = Math.max(cursor, end);
      });
      if (cursor < wallLen) {
        ctx.beginPath();
        ctx.moveTo(tx(a.x + ux * cursor), ty(a.y + uy * cursor));
        ctx.lineTo(tx(c.x), ty(c.y));
        ctx.stroke();
      }

      // Wall dimension
      if (options.showWallDimensions) {
        const midX = (a.x + c.x) / 2;
        const midY = (a.y + c.y) / 2;
        const nx = -uy, ny = ux;
        const offset = 18 / scale;
        const lx = tx(midX + nx * offset);
        const ly = ty(midY + ny * offset);
        const label = wallLen >= 100 ? `${(wallLen / 100).toFixed(2)} m` : `${Math.round(wallLen)} cm`;
        ctx.fillStyle = COLORS.muted;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, lx, ly);
      }
    }
  });

  // Doors (arc)
  doors.forEach((door) => {
    const room = rooms.find((r) => r.id === door.roomId);
    if (!room || door.edgeIndex >= room.points.length) return;
    const a = room.points[door.edgeIndex];
    const c = room.points[(door.edgeIndex + 1) % room.points.length];
    const wallLen = Math.hypot(c.x - a.x, c.y - a.y);
    if (wallLen === 0) return;
    const ux = (c.x - a.x) / wallLen, uy = (c.y - a.y) / wallLen;
    const nx = -uy, ny = ux;
    const cd = door.positionRatio * wallLen;
    const hinge = door.openDirection === "right"
      ? { x: a.x + ux * (cd + door.width / 2), y: a.y + uy * (cd + door.width / 2) }
      : { x: a.x + ux * (cd - door.width / 2), y: a.y + uy * (cd - door.width / 2) };
    const sweepSide = door.openSide === "interior" ? 1 : -1;
    const startAngle = Math.atan2(
      door.openDirection === "right" ? -ux : ux,
      door.openDirection === "right" ? -uy : uy,
    );
    ctx.strokeStyle = COLORS.door;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(
      tx(hinge.x),
      ty(hinge.y),
      ts(door.width),
      Math.atan2(ny * sweepSide, nx * sweepSide),
      Math.atan2(ny * sweepSide, nx * sweepSide) + (sweepSide > 0 ? Math.PI / 2 : -Math.PI / 2),
      sweepSide < 0,
    );
    ctx.stroke();
    // Door leaf line
    ctx.beginPath();
    ctx.moveTo(tx(hinge.x), ty(hinge.y));
    const leafEnd = {
      x: hinge.x + nx * sweepSide * door.width,
      y: hinge.y + ny * sweepSide * door.width,
    };
    ctx.lineTo(tx(leafEnd.x), ty(leafEnd.y));
    ctx.stroke();
  });

  // Pillars
  pillars.forEach((p) => {
    ctx.fillStyle = COLORS.pillar;
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = 1.5;
    if (p.shape === "round") {
      ctx.beginPath();
      ctx.arc(tx(p.position.x), ty(p.position.y), ts(p.width / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(tx(p.position.x), ty(p.position.y));
      ctx.rotate(((p.rotation || 0) * Math.PI) / 180);
      const w = ts(p.width), d = ts(p.depth);
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      ctx.restore();
    }
  });

  // Room labels
  rooms.forEach((room) => {
    if (!room.isClosed || room.points.length < 3) return;
    const cx = room.points.reduce((s, p) => s + p.x, 0) / room.points.length;
    const cy = room.points.reduce((s, p) => s + p.y, 0) / room.points.length;
    ctx.fillStyle = COLORS.muted;
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.name, tx(cx), ty(cy));
  });

  // Equipments
  if (showEq) {
    equipments.forEach((eq) => {
      ctx.save();
      ctx.translate(tx(eq.position.x), ty(eq.position.y));
      ctx.rotate(((eq.rotation || 0) * Math.PI) / 180);
      const w = ts(eq.width), d = ts(eq.depth);
      ctx.fillStyle = COLORS.equipmentFill;
      ctx.strokeStyle = COLORS.equipment;
      ctx.lineWidth = 1.5;
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      // Front indicator (small line on front edge -y in local)
      ctx.beginPath();
      ctx.moveTo(-w / 2, -d / 2);
      ctx.lineTo(w / 2, -d / 2);
      ctx.strokeStyle = COLORS.equipment;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Label (no rotation for readability)
      ctx.fillStyle = COLORS.equipmentLabel;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = eq.name.length > 18 ? eq.name.slice(0, 17) + "…" : eq.name;
      ctx.fillText(label, tx(eq.position.x), ty(eq.position.y));
    });
  }

  // Gap measurements
  if (options.showGapMeasurements && showEq && equipments.length > 0) {
    const wallSegs: { a: Point; b: Point }[] = [];
    rooms.forEach((room) => {
      const n = room.isClosed ? room.points.length : room.points.length - 1;
      for (let i = 0; i < n; i++) {
        wallSegs.push({ a: room.points[i], b: room.points[(i + 1) % room.points.length] });
      }
    });
    const drawnPairs = new Set<string>();

    equipments.forEach((eq) => {
      const rad = ((eq.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const hw = eq.width / 2, hd = eq.depth / 2;
      const directions = [
        { dir: { x: 0, y: -1 }, off: { x: 0, y: -hd } },
        { dir: { x: 0, y: 1 }, off: { x: 0, y: hd } },
        { dir: { x: -1, y: 0 }, off: { x: -hw, y: 0 } },
        { dir: { x: 1, y: 0 }, off: { x: hw, y: 0 } },
      ];

      directions.forEach(({ dir, off }) => {
        const edge = {
          x: eq.position.x + off.x * cos - off.y * sin,
          y: eq.position.y + off.x * sin + off.y * cos,
        };
        const wdir = {
          x: dir.x * cos - dir.y * sin,
          y: dir.x * sin + dir.y * cos,
        };
        let minD = Infinity;
        let hit: Point | null = null;
        let hitEq: string | null = null;

        wallSegs.forEach(({ a, b }) => {
          const t = raySegmentIntersect(edge, wdir, a, b);
          if (t !== null && t < minD) {
            minD = t; hit = { x: edge.x + wdir.x * t, y: edge.y + wdir.y * t }; hitEq = null;
          }
        });
        equipments.forEach((other) => {
          if (other.id === eq.id) return;
          const oR = ((other.rotation || 0) * Math.PI) / 180;
          const oC = Math.cos(oR), oS = Math.sin(oR);
          const ohw = other.width / 2, ohd = other.depth / 2;
          const corners = [
            { x: -ohw, y: -ohd }, { x: ohw, y: -ohd },
            { x: ohw, y: ohd }, { x: -ohw, y: ohd },
          ].map((c) => ({
            x: other.position.x + c.x * oC - c.y * oS,
            y: other.position.y + c.x * oS + c.y * oC,
          }));
          for (let i = 0; i < 4; i++) {
            const t = raySegmentIntersect(edge, wdir, corners[i], corners[(i + 1) % 4]);
            if (t !== null && t < minD) {
              minD = t; hit = { x: edge.x + wdir.x * t, y: edge.y + wdir.y * t }; hitEq = other.id;
            }
          }
        });

        if (hitEq) {
          const k = [eq.id, hitEq].sort().join("|");
          if (drawnPairs.has(k)) return;
          drawnPairs.add(k);
        }
        if (hit && minD > 1 && minD < 800) {
          const distCm = Math.round(minD);
          const sx = tx(edge.x), sy = ty(edge.y);
          const ex = tx((hit as Point).x), ey = ty((hit as Point).y);
          ctx.strokeStyle = COLORS.dim;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.setLineDash([]);
          // Tick marks
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.arc(ex, ey, 2, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.dim;
          ctx.fill();
          // Label
          const mx = (sx + ex) / 2, my = (sy + ey) / 2;
          const label = distCm >= 100 ? `${(distCm / 100).toFixed(2)} m` : `${distCm} cm`;
          ctx.fillStyle = "#ffffff";
          const tw = ctx.measureText(label).width + 6;
          ctx.fillRect(mx - tw / 2, my - 7, tw, 14);
          ctx.fillStyle = COLORS.dimText;
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, mx, my);
        }
      });
    });
  }

  // Legend / footer
  ctx.fillStyle = COLORS.muted;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  const scaleM = (100 / scale).toFixed(0);
  ctx.fillText(`Échelle : 1 carreau = 1 m`, W - 24, H - 20);

  return canvas.toDataURL("image/png");
}
