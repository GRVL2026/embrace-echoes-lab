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
  bg: "#060619",
  bgGradient: "#0c0c2a",
  wall: "#9b5cff",
  wallFill: "rgba(155, 92, 255, 0.08)",
  door: "#73ffb8",
  pillar: "#475569",
  pillarStroke: "#94a3b8",
  equipmentDefault: "#9b5cff",
  equipmentLabel: "#ffffff",
  dim: "#73ffb8",
  dimText: "#ffffff",
  dimBg: "rgba(6, 6, 25, 0.85)",
  circulation: "#73ffb8",
  circulationFill: "rgba(115, 255, 184, 0.22)",
  grid: "rgba(155, 92, 255, 0.08)",
  gridMajor: "rgba(155, 92, 255, 0.16)",
  text: "#f5f5ff",
  muted: "#8b8bb5",
};

/** Parse "hsl(h, s%, l%)" or "#rrggbb" to {r,g,b}. */
function parseColor(input?: string): { r: number; g: number; b: number } {
  if (!input) return { r: 155, g: 92, b: 255 };
  const m = input.match(/hsl\(\s*([\d.]+)[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?\s*\)/i);
  if (m) {
    const h = parseFloat(m[1]) / 360, s = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
  }
  const h = input.replace("#", "");
  if (h.length === 6) {
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  return { r: 155, g: 92, b: 255 };
}
const rgba = (c: { r: number; g: number; b: number }, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;
const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r},${c.g},${c.b})`;


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

  // Dark gradient background (matches editor)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, COLORS.bgGradient);
  bgGrad.addColorStop(1, COLORS.bg);
  ctx.fillStyle = bgGrad;
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

  // Circulation path (matches editor: smoothed chains, green corridor, PMR turning zones)
  if (options.showCirculation && circulation.length > 0) {
    // Build continuous chains from segments
    const chains: Point[][] = [];
    let cur: Point[] = [];
    for (const seg of circulation) {
      if (cur.length === 0) {
        cur.push(seg.start, seg.end);
      } else {
        const last = cur[cur.length - 1];
        const d = Math.hypot(last.x - seg.start.x, last.y - seg.start.y);
        if (d < 30) cur.push(seg.end);
        else { chains.push(cur); cur = [seg.start, seg.end]; }
      }
    }
    if (cur.length > 0) chains.push(cur);

    const dedup = (ch: Point[], minD: number) => {
      const out: Point[] = [];
      for (const p of ch) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minD) out.push(p);
      }
      return out;
    };
    const smooth = (ch: Point[], iters: number) => {
      let pts = ch;
      for (let k = 0; k < iters; k++) {
        if (pts.length < 3) break;
        const next: Point[] = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
          next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
        }
        next.push(pts[pts.length - 1]);
        pts = next;
      }
      return pts;
    };

    const stdWidth = Math.min(...circulation.map(s => s.width || 120));
    const corridorPx = ts(stdWidth);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let ci = 0; ci < chains.length; ci++) {
      let chain = dedup(chains[ci], 8);
      chain = smooth(chain, 1);
      chain = dedup(chain, 3);
      if (chain.length < 2) continue;

      const tracePath = () => {
        ctx.beginPath();
        ctx.moveTo(tx(chain[0].x), ty(chain[0].y));
        for (let i = 1; i < chain.length - 1; i++) {
          const mx = (chain[i].x + chain[i + 1].x) / 2;
          const my = (chain[i].y + chain[i + 1].y) / 2;
          ctx.quadraticCurveTo(tx(chain[i].x), ty(chain[i].y), tx(mx), ty(my));
        }
        const last = chain[chain.length - 1];
        ctx.lineTo(tx(last.x), ty(last.y));
      };

      // Outer corridor — translucent green
      tracePath();
      ctx.strokeStyle = "hsla(142, 70%, 40%, 0.35)";
      ctx.lineWidth = corridorPx;
      ctx.stroke();

      // Inner lighter fill
      tracePath();
      ctx.strokeStyle = "hsla(142, 70%, 50%, 0.10)";
      ctx.lineWidth = Math.max(1, corridorPx - 4);
      ctx.stroke();

      // Centerline dashed
      tracePath();
      ctx.strokeStyle = "hsla(142, 70%, 60%, 0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 10]);
      ctx.stroke();
      ctx.setLineDash([]);

      // PMR turning zones at chain ends (1.40 m diameter)
      const turnR = ts(70);
      for (const pt of [chain[0], chain[chain.length - 1]]) {
        const px = tx(pt.x), py = ty(pt.y);
        ctx.beginPath();
        ctx.arc(px, py, turnR, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(200, 70%, 50%, 0.10)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, turnR, 0, Math.PI * 2);
        ctx.strokeStyle = "hsla(200, 70%, 60%, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "hsla(200, 80%, 75%, 0.85)";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("PMR 1.40m", px, py - turnR - 4);
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(142, 70%, 55%, 0.8)";
        ctx.fill();
      }
    }

    // Width label on the central chain
    if (chains.length > 0) {
      let ch0 = dedup(chains[0], 8);
      ch0 = smooth(ch0, 2);
      ch0 = dedup(ch0, 3);
      if (ch0.length > 1) {
        const mid = ch0[Math.floor(ch0.length / 2)];
        const mx = tx(mid.x), my = ty(mid.y);
        const segWidth = circulation[Math.floor(circulation.length / 2)]?.width || 120;
        const text = `↔ ${(segWidth / 100).toFixed(2).replace(/0$/, "")}m`;
        ctx.font = "bold 13px sans-serif";
        const tw = ctx.measureText(text).width;
        const pad = 5;
        const rw = tw + pad * 2, rh = 18 + pad;
        const rx = mx - rw / 2, ry = my - rh / 2;
        ctx.fillStyle = "hsla(142, 60%, 18%, 0.9)";
        ctx.strokeStyle = "hsla(142, 70%, 50%, 0.6)";
        ctx.lineWidth = 1;
        const r = 5;
        ctx.beginPath();
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + rw - r, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
        ctx.lineTo(rx + rw, ry + rh - r);
        ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
        ctx.lineTo(rx + r, ry + rh);
        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "hsla(142, 85%, 78%, 1)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, mx, my);
      }
    }
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

  // Equipments — colored per category (matches editor canvas)
  if (showEq) {
    equipments.forEach((eq) => {
      const col = parseColor(eq.color);
      ctx.save();
      ctx.translate(tx(eq.position.x), ty(eq.position.y));
      ctx.rotate(((eq.rotation || 0) * Math.PI) / 180);
      const w = ts(eq.width), d = ts(eq.depth);
      // Soft glow
      ctx.shadowColor = rgba(col, 0.55);
      ctx.shadowBlur = 12;
      ctx.fillStyle = rgba(col, 0.22);
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgb(col);
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      // Front indicator
      ctx.beginPath();
      ctx.moveTo(-w / 2, -d / 2);
      ctx.lineTo(w / 2, -d / 2);
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.restore();

      // Label (no rotation for readability) — color matches equipment
      ctx.fillStyle = rgb(col);
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = eq.name.length > 18 ? eq.name.slice(0, 17) + "…" : eq.name;
      // Slight dark halo behind label for legibility
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 4;
      ctx.fillText(label, tx(eq.position.x), ty(eq.position.y));
      ctx.shadowBlur = 0;
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
          ctx.fillStyle = COLORS.dimBg;
          const tw = ctx.measureText(label).width + 8;
          ctx.fillRect(mx - tw / 2, my - 8, tw, 16);

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
  ctx.fillText(`Échelle : 1 carreau = 1 m`, W - 24, H - 20);

  return canvas.toDataURL("image/png");
}
