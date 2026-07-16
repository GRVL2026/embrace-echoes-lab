/**
 * Shared circulation-path geometry helpers.
 * Used by circulation.ts (pathfinding smoothing), EditorCanvas.tsx (2D),
 * plan2DRender.ts (PDF) and Circulation3D.tsx (3D ribbon), so the corridor
 * looks identical everywhere.
 */
import type { Point, CirculationSegment } from "@/types/editor";

/** Build continuous chains of points from consecutive segments. */
export function buildChains(segments: CirculationSegment[], joinDist = 30): Point[][] {
  const chains: Point[][] = [];
  let cur: Point[] = [];
  for (const seg of segments) {
    if (cur.length === 0) {
      cur.push(seg.start, seg.end);
    } else {
      const last = cur[cur.length - 1];
      const d = Math.hypot(last.x - seg.start.x, last.y - seg.start.y);
      if (d < joinDist) cur.push(seg.end);
      else { chains.push(cur); cur = [seg.start, seg.end]; }
    }
  }
  if (cur.length > 0) chains.push(cur);
  return chains;
}

export function deduplicateChain(chain: Point[], minDist: number): Point[] {
  if (chain.length < 2) return chain;
  const result: Point[] = [chain[0]];
  const m2 = minDist * minDist;
  for (let i = 1; i < chain.length; i++) {
    const prev = result[result.length - 1];
    const dx = chain[i].x - prev.x;
    const dy = chain[i].y - prev.y;
    if (dx * dx + dy * dy >= m2) result.push(chain[i]);
  }
  const last = chain[chain.length - 1];
  const rLast = result[result.length - 1];
  if (last.x !== rLast.x || last.y !== rLast.y) result.push(last);
  return result;
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * Sample a Catmull-Rom spline through `chain` every ~stepCm.
 * If `isBlocked` is given and any sample lands in an obstacle, falls back
 * to the raw chain (linear).
 */
export function sampleSpline(chain: Point[], stepCm = 10, isBlocked?: (p: Point) => boolean): Point[] {
  if (chain.length < 2) return chain;
  if (chain.length === 2) return chain;

  const first = chain[0], last = chain[chain.length - 1];
  const pts: Point[] = [
    { x: 2 * first.x - chain[1].x, y: 2 * first.y - chain[1].y },
    ...chain,
    { x: 2 * last.x - chain[chain.length - 2].x, y: 2 * last.y - chain[chain.length - 2].y },
  ];

  const out: Point[] = [chain[0]];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(2, Math.ceil(segLen / stepCm));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const p = catmullRom(p0, p1, p2, p3, t);
      if (isBlocked && isBlocked(p)) return chain; // safety fallback
      out.push(p);
    }
  }
  return out;
}

/** Convert a list of segments into a list of clean, smoothed chains. */
export function segmentsToSmoothChains(
  segments: CirculationSegment[],
  stepCm = 10,
): Point[][] {
  const chains = buildChains(segments);
  const out: Point[][] = [];
  for (const raw of chains) {
    let c = deduplicateChain(raw, 8);
    c = sampleSpline(c, stepCm);
    c = deduplicateChain(c, Math.max(3, stepCm * 0.4));
    if (c.length >= 2) out.push(c);
  }
  return out;
}

/**
 * Miter-offset a polyline by ±halfWidth on both sides.
 * Returns { left, right } same length as chain.
 */
export function buildRibbonSides(
  chain: Point[],
  halfWidth: number,
  miterLimit = 2,
): { left: Point[]; right: Point[] } {
  const n = chain.length;
  const left: Point[] = new Array(n);
  const right: Point[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let nx: number, ny: number;
    if (i === 0) {
      const dx = chain[1].x - chain[0].x, dy = chain[1].y - chain[0].y;
      const L = Math.hypot(dx, dy) || 1;
      nx = -dy / L; ny = dx / L;
    } else if (i === n - 1) {
      const dx = chain[i].x - chain[i - 1].x, dy = chain[i].y - chain[i - 1].y;
      const L = Math.hypot(dx, dy) || 1;
      nx = -dy / L; ny = dx / L;
    } else {
      const d1x = chain[i].x - chain[i - 1].x, d1y = chain[i].y - chain[i - 1].y;
      const L1 = Math.hypot(d1x, d1y) || 1;
      const d2x = chain[i + 1].x - chain[i].x, d2y = chain[i + 1].y - chain[i].y;
      const L2 = Math.hypot(d2x, d2y) || 1;
      const n1x = -d1y / L1, n1y = d1x / L1;
      const n2x = -d2y / L2, n2y = d2x / L2;
      let mx = n1x + n2x, my = n1y + n2y;
      const mL = Math.hypot(mx, my);
      if (mL < 1e-4) { nx = n1x; ny = n1y; }
      else {
        mx /= mL; my /= mL;
        const dot = mx * n1x + my * n1y;
        const miter = Math.min(miterLimit, dot > 0.001 ? 1 / dot : miterLimit);
        nx = mx * miter; ny = my * miter;
      }
    }
    left[i]  = { x: chain[i].x + nx * halfWidth, y: chain[i].y + ny * halfWidth };
    right[i] = { x: chain[i].x - nx * halfWidth, y: chain[i].y - ny * halfWidth };
  }
  return { left, right };
}
