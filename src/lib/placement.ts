import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { DOOR_EXCLUSION_DEPTH } from "@/types/equipment";
import { computeCirculation } from "@/lib/circulation";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const CORRIDOR_WIDTH = 120; // Rule 1: 1.2m standard corridor (turning zones 1.4m at extremities handled by circulation)
const SAME_REF_GAP = 2;    // 2cm between identical references
const DIFFERENT_GAP = 10;  // 10cm between different equipment
const WALL_MARGIN = 5;     // 5cm from wall surface
const MIN_OVERLAP_GAP = 2; // 2cm SAT safety margin

// ═══════════════════════════════════════════════════════════════════
// GEOMETRY UTILITIES
// ═══════════════════════════════════════════════════════════════════

function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function rectInsidePolygon(cx: number, cy: number, w: number, d: number, rot: number, polygon: Point[]): boolean {
  return getRectCorners(cx, cy, w, d, rot).every(c => pointInPolygon(c, polygon));
}

function getRectCorners(cx: number, cy: number, w: number, d: number, rot: number): Point[] {
  const hw = w / 2, hd = d / 2;
  const cos = Math.cos(rot * Math.PI / 180);
  const sin = Math.sin(rot * Math.PI / 180);
  return [
    { x: cx + (-hw) * cos - (-hd) * sin, y: cy + (-hw) * sin + (-hd) * cos },
    { x: cx + (hw) * cos - (-hd) * sin, y: cy + (hw) * sin + (-hd) * cos },
    { x: cx + (hw) * cos - (hd) * sin, y: cy + (hw) * sin + (hd) * cos },
    { x: cx + (-hw) * cos - (hd) * sin, y: cy + (-hw) * sin + (hd) * cos },
  ];
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ad: number, aRot: number,
  bx: number, by: number, bw: number, bd: number, bRot: number,
): boolean {
  return satOverlap(
    getRectCorners(ax, ay, aw, ad, aRot),
    getRectCorners(bx, by, bw, bd, bRot),
  );
}

function satOverlap(cornersA: Point[], cornersB: Point[]): boolean {
  for (const corners of [cornersA, cornersB]) {
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      const axis = { x: -(corners[j].y - corners[i].y), y: corners[j].x - corners[i].x };
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const c of cornersA) { const p = c.x * axis.x + c.y * axis.y; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
      for (const c of cornersB) { const p = c.x * axis.x + c.y * axis.y; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

function ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
}

function polygonSignedArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

/** Get the "front" direction of equipment (the side players face) */
function getFrontDirection(rot: number): { x: number; y: number } {
  const rad = rot * Math.PI / 180;
  return { x: -Math.sin(rad), y: Math.cos(rad) };
}

// ═══════════════════════════════════════════════════════════════════
// EXCLUSION ZONES (doors, pillars)
// ═══════════════════════════════════════════════════════════════════

function getDoorExclusionZones(rooms: Room[], doors: Door[]): { cx: number; cy: number; w: number; d: number; rot: number }[] {
  const zones: { cx: number; cy: number; w: number; d: number; rot: number }[] = [];
  for (const door of doors) {
    const room = rooms.find(r => r.id === door.roomId);
    if (!room || door.edgeIndex >= room.points.length) continue;
    const a = room.points[door.edgeIndex];
    const b = room.points[(door.edgeIndex + 1) % room.points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen === 0) continue;
    const ux = dx / wallLen, uy = dy / wallLen;
    const nx = -uy, ny = ux;
    const centerDist = door.positionRatio * wallLen;
    const doorCx = a.x + ux * centerDist;
    const doorCy = a.y + uy * centerDist;
    const rot = Math.atan2(dy, dx) * 180 / Math.PI;
    zones.push({ cx: doorCx + nx * DOOR_EXCLUSION_DEPTH / 2, cy: doorCy + ny * DOOR_EXCLUSION_DEPTH / 2, w: door.width + 40, d: DOOR_EXCLUSION_DEPTH, rot });
    zones.push({ cx: doorCx - nx * DOOR_EXCLUSION_DEPTH / 2, cy: doorCy - ny * DOOR_EXCLUSION_DEPTH / 2, w: door.width + 40, d: DOOR_EXCLUSION_DEPTH, rot });
  }
  return zones;
}

function getPillarExclusionZones(pillars: Pillar[]): { cx: number; cy: number; w: number; d: number; rot: number }[] {
  return pillars.map(p => ({
    cx: p.position.x, cy: p.position.y,
    w: p.width + 20, d: p.depth + 20, rot: p.rotation || 0,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// WALL ANALYSIS
// ═══════════════════════════════════════════════════════════════════

type WallSegment = {
  start: Point; end: Point; length: number; angle: number;
  normalX: number; normalY: number; edgeIndex: number; hasDoor: boolean;
};

function getRoomWalls(room: Room, doors: Door[]): WallSegment[] {
  const walls: WallSegment[] = [];
  const pts = room.points;
  const normalSign = polygonSignedArea(pts) > 0 ? 1 : -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    const ux = dx / length, uy = dy / length;
    const nx = -uy * normalSign, ny = ux * normalSign;
    const hasDoor = doors.some(d => d.roomId === room.id && d.edgeIndex === i);
    walls.push({ start: pts[i], end: pts[j], length, angle: Math.atan2(dy, dx) * 180 / Math.PI, normalX: nx, normalY: ny, edgeIndex: i, hasDoor });
  }
  return walls;
}

// ═══════════════════════════════════════════════════════════════════
// COLLISION & VALIDATION
// ═══════════════════════════════════════════════════════════════════

/** Check if two equipment are side-by-side (same rotation, aligned laterally) */
function isSideBySide(cx: number, cy: number, w: number, d: number, rot: number, pe: PlacedEquipment): boolean {
  const rotDiff = Math.abs(((rot - pe.rotation) % 360 + 360) % 360);
  if (rotDiff > 3 && rotDiff < 357) return false;
  const front = getFrontDirection(rot);
  const dx = pe.position.x - cx, dy = pe.position.y - cy;
  const depthOffset = Math.abs(dx * front.x + dy * front.y);
  const lateralOffset = Math.abs(dx * (-front.y) + dy * front.x);
  const maxDepthTolerance = (d / 2 + pe.depth / 2) * 0.15;
  return depthOffset <= maxDepthTolerance && lateralOffset >= 1;
}

/** Get front clearance zone rectangle */
function getFrontClearanceZone(cx: number, cy: number, w: number, d: number, rot: number, clearanceDepth: number) {
  const front = getFrontDirection(rot);
  return {
    cx: cx + front.x * (d / 2 + clearanceDepth / 2),
    cy: cy + front.y * (d / 2 + clearanceDepth / 2),
    w: w * 1.2, d: clearanceDepth, rot,
  };
}

/** Check face-to-face minimum distance */
function checkFaceToFace(cx: number, cy: number, d: number, rot: number, existing: PlacedEquipment[]): boolean {
  const newFront = getFrontDirection(rot);
  const newFrontX = cx + newFront.x * (d / 2);
  const newFrontY = cy + newFront.y * (d / 2);
  for (const pe of existing) {
    const ef = getFrontDirection(pe.rotation);
    const dot = newFront.x * ef.x + newFront.y * ef.y;
    if (dot > -0.5) continue;
    const efX = pe.position.x + ef.x * (pe.depth / 2);
    const efY = pe.position.y + ef.y * (pe.depth / 2);
    const dx = efX - newFrontX, dy = efY - newFrontY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;
    const alignDot = Math.abs((dx / dist) * newFront.x + (dy / dist) * newFront.y);
    if (alignDot < 0.5) continue;
    if (dist < CORRIDOR_WIDTH) return false;
  }
  return true;
}

/** Full validation for wall-backed equipment */
function isPlacementValid(
  cx: number, cy: number, w: number, d: number, rot: number, gap: number,
  room: Room,
  doorZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  pillarZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  existing: PlacedEquipment[],
  skipFrontCheck: boolean = false,
): boolean {
  if (!rectInsidePolygon(cx, cy, w, d, rot, room.points)) return false;
  for (const dz of doorZones) {
    if (rectsOverlap(cx, cy, w, d, rot, dz.cx, dz.cy, dz.w, dz.d, dz.rot)) return false;
  }
  for (const pz of pillarZones) {
    if (rectsOverlap(cx, cy, w + 20, d + 20, rot, pz.cx, pz.cy, pz.w, pz.d, pz.rot)) return false;
  }
  const effectiveGap = Math.max(gap, MIN_OVERLAP_GAP);
  for (const pe of existing) {
    if (rectsOverlap(cx, cy, w + effectiveGap, d + effectiveGap, rot, pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation)) return false;
  }

  if (!skipFrontCheck) {
    const newFrontZone = getFrontClearanceZone(cx, cy, w, d, rot, CORRIDOR_WIDTH);
    for (const pe of existing) {
      if (isSideBySide(cx, cy, w, d, rot, pe)) continue;
      if (rectsOverlap(newFrontZone.cx, newFrontZone.cy, newFrontZone.w, newFrontZone.d, newFrontZone.rot,
        pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation)) return false;
    }
    for (const pe of existing) {
      if (pe.centerPlacement) continue;
      if (isSideBySide(cx, cy, w, d, rot, pe)) continue;
      const existingFZ = getFrontClearanceZone(pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation, CORRIDOR_WIDTH);
      if (rectsOverlap(existingFZ.cx, existingFZ.cy, existingFZ.w, existingFZ.d, existingFZ.rot,
        cx, cy, w, d, rot)) return false;
    }
    if (!checkFaceToFace(cx, cy, d, rot, existing)) return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════
// POSITION GENERATION
// ═══════════════════════════════════════════════════════════════════

/** Generate wall-backed positions for equipment along a wall */
function generateWallPositions(
  wall: WallSegment, equipWidth: number, equipDepth: number, step: number = 5, preferCorner: boolean = false,
): { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] {
  const positions: { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] = [];
  const rotation = ((Math.atan2(-wall.normalX, wall.normalY) * 180 / Math.PI) + 360) % 360;
  const distFromWall = equipDepth / 2 + WALL_MARGIN;
  const margin = equipWidth / 2 + WALL_MARGIN;
  if (wall.length - margin * 2 < 0) return positions;

  // Regular grid positions
  for (let t = margin; t <= wall.length - margin; t += step) {
    const ratio = t / wall.length;
    const wx = wall.start.x + (wall.end.x - wall.start.x) * ratio;
    const wy = wall.start.y + (wall.end.y - wall.start.y) * ratio;
    const x = wx + wall.normalX * distFromWall;
    const y = wy + wall.normalY * distFromWall;
    const distFromEdges = Math.min(t, wall.length - t);
    const cornerBonus = preferCorner && distFromEdges < equipWidth ? -20 : 0;
    const doorPenalty = wall.hasDoor ? 50 : 0;
    positions.push({ x, y, rotation, score: cornerBonus + doorPenalty, wall });
  }

  // Exact corner positions
  for (const t of [margin, wall.length - margin]) {
    const ratio = t / wall.length;
    const wx = wall.start.x + (wall.end.x - wall.start.x) * ratio;
    const wy = wall.start.y + (wall.end.y - wall.start.y) * ratio;
    const x = wx + wall.normalX * distFromWall;
    const y = wy + wall.normalY * distFromWall;
    const cornerBonus = preferCorner ? -30 : 0;
    const doorPenalty = wall.hasDoor ? 50 : 0;
    positions.push({ x, y, rotation, score: cornerBonus + doorPenalty, wall });
  }

  return positions;
}

/** Generate adjacent positions next to already-placed equipment (same rotation) */
function generateAdjacentPositions(
  prevX: number, prevY: number, prevRot: number,
  prevW: number, prevD: number,
  curW: number, curD: number, gap: number,
): { x: number; y: number; rotation: number }[] {
  const positions: { x: number; y: number; rotation: number }[] = [];
  const rad = prevRot * Math.PI / 180;
  const wallDirX = Math.cos(rad);
  const wallDirY = Math.sin(rad);
  const baseSpacing = prevW / 2 + curW / 2 + Math.max(gap, 1);
  // Depth correction: align backs to wall
  const front = getFrontDirection(prevRot);
  const depthCorr = (curD - prevD) / 2;
  const corrX = front.x * depthCorr;
  const corrY = front.y * depthCorr;

  for (const mult of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
    const sign = mult > 0 ? 1 : -1;
    const idx = Math.abs(mult);
    const dist = baseSpacing + (idx - 1) * (curW + gap);
    positions.push({
      x: prevX + wallDirX * dist * sign + corrX,
      y: prevY + wallDirY * dist * sign + corrY,
      rotation: prevRot,
    });
  }
  return positions;
}

/** Generate second-row positions: equipment facing the OPPOSITE side of the corridor
 *  Rule 2 extended: when walls are full, place facing across the corridor to create an aisle.
 *  Wall equipment corridor takes priority. */
function generateSecondRowPositions(
  wall: WallSegment,
  equipWidth: number,
  equipDepth: number,
  maxWallDepth: number, // depth of deepest wall-backed equipment on this wall
  step: number = 5,
): { x: number; y: number; rotation: number; rotated90: boolean; score: number; wall: WallSegment }[] {
  const positions: { x: number; y: number; rotation: number; rotated90: boolean; score: number; wall: WallSegment }[] = [];
  
  // The wall-backed equipment faces inward with rotation R.
  // The second-row equipment faces the OTHER side → rotation = (R + 180) % 360
  const wallRotation = ((Math.atan2(-wall.normalX, wall.normalY) * 180 / Math.PI) + 360) % 360;
  const facingRotation = (wallRotation + 180) % 360; // faces back toward the wall row
  const rotated90Rotation = (wallRotation + 90) % 360; // adjacent side faces corridor
  
  // Distance from wall: wall_margin + maxWallDepth + corridor + equipDepth/2
  // Rule 5: corridor aligned to deepest wall equipment
  const distFromWall = WALL_MARGIN + maxWallDepth + CORRIDOR_WIDTH + equipDepth / 2;
  const dist90FromWall = WALL_MARGIN + maxWallDepth + CORRIDOR_WIDTH + equipWidth / 2; // when rotated 90°

  const margin = equipWidth / 2 + WALL_MARGIN;
  const margin90 = equipDepth / 2 + WALL_MARGIN;

  // Normal facing positions (face toward wall row, creating shared aisle)
  if (wall.length - margin * 2 >= 0) {
    for (let t = margin; t <= wall.length - margin; t += step) {
      const ratio = t / wall.length;
      const wx = wall.start.x + (wall.end.x - wall.start.x) * ratio;
      const wy = wall.start.y + (wall.end.y - wall.start.y) * ratio;
      const x = wx + wall.normalX * distFromWall;
      const y = wy + wall.normalY * distFromWall;
      positions.push({ x, y, rotation: facingRotation, rotated90: false, score: 500, wall });
    }
  }

  // Rotated 90° positions (for when normal facing would block wall corridor)
  if (wall.length - margin90 * 2 >= 0) {
    for (let t = margin90; t <= wall.length - margin90; t += step) {
      const ratio = t / wall.length;
      const wx = wall.start.x + (wall.end.x - wall.start.x) * ratio;
      const wy = wall.start.y + (wall.end.y - wall.start.y) * ratio;
      const x = wx + wall.normalX * dist90FromWall;
      const y = wy + wall.normalY * dist90FromWall;
      // Higher score = less preferred (fallback)
      positions.push({ x, y, rotation: rotated90Rotation, rotated90: true, score: 800, wall });
    }
  }

  return positions;
}

// ═══════════════════════════════════════════════════════════════════
// CENTER TABLE PLACEMENT (Phase 3 — Rule 9)
// ═══════════════════════════════════════════════════════════════════

function checkCenterTableGap(
  cx: number, cy: number, w: number, d: number, rot: number,
  playerClearance: number, pe: PlacedEquipment,
): boolean {
  const rad = rot * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = pe.position.x - cx, dy = pe.position.y - cy;
  const sepW = Math.abs(dx * cos + dy * sin);
  const sepD = Math.abs(dx * (-sin) + dy * cos);
  const halfW = w / 2, halfD = d / 2;
  const peRad = pe.rotation * Math.PI / 180;
  const peCos = Math.cos(peRad), peSin = Math.sin(peRad);
  const peHW = Math.abs(pe.width / 2 * peCos * cos + pe.width / 2 * peSin * sin) +
               Math.abs(pe.depth / 2 * (-peSin) * cos + pe.depth / 2 * peCos * sin);
  const peHD = Math.abs(pe.width / 2 * peCos * (-sin) + pe.width / 2 * peSin * cos) +
               Math.abs(pe.depth / 2 * (-peSin) * (-sin) + pe.depth / 2 * peCos * cos);
  const gapW = sepW - halfW - peHW;
  const gapD = sepD - halfD - peHD;

  if (gapW > 0 && gapD > 0) {
    if (!pe.centerPlacement) return gapW >= CORRIDOR_WIDTH || gapD >= CORRIDOR_WIDTH;
    return true;
  }
  if (gapW <= 0 && gapD <= 0) return false;
  const isWidthLong = w >= d;
  if (gapW > 0) {
    if (isWidthLong) return gapW >= playerClearance;
    if (pe.centerPlacement) return gapW >= 0;
    return gapW >= CORRIDOR_WIDTH;
  }
  if (gapD > 0) {
    if (!isWidthLong) return gapD >= playerClearance;
    if (pe.centerPlacement) return gapD >= 0;
    return gapD >= CORRIDOR_WIDTH;
  }
  return true;
}

function isCenterPlacementValid(
  cx: number, cy: number, w: number, d: number, rot: number,
  playerClearance: number, room: Room,
  doorZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  pillarZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  existing: PlacedEquipment[],
): boolean {
  if (!rectInsidePolygon(cx, cy, w, d, rot, room.points)) return false;
  const corners = getRectCorners(cx, cy, w, d, rot);
  const pts = room.points;
  const edgeCount = room.isClosed ? pts.length : pts.length - 1;
  for (const corner of corners) {
    for (let i = 0; i < edgeCount; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (ptSegDist(corner.x, corner.y, a.x, a.y, b.x, b.y) < CORRIDOR_WIDTH) return false;
    }
  }
  for (const dz of doorZones) {
    if (rectsOverlap(cx, cy, w, d, rot, dz.cx, dz.cy, dz.w, dz.d, dz.rot)) return false;
  }
  for (const pz of pillarZones) {
    if (rectsOverlap(cx, cy, w + 20, d + 20, rot, pz.cx, pz.cy, pz.w, pz.d, pz.rot)) return false;
  }
  for (const pe of existing) {
    if (rectsOverlap(cx, cy, w + MIN_OVERLAP_GAP, d + MIN_OVERLAP_GAP, rot, pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation)) return false;
  }
  for (const pe of existing) {
    if (!checkCenterTableGap(cx, cy, w, d, rot, playerClearance, pe)) return false;
  }
  for (const pe of existing) {
    if (pe.centerPlacement) continue;
    const fz = getFrontClearanceZone(pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation, CORRIDOR_WIDTH);
    if (rectsOverlap(fz.cx, fz.cy, fz.w, fz.d, fz.rot, cx, cy, w, d, rot)) return false;
  }
  return true;
}

function generateCenterPlacementPositions(
  room: Room, equipWidth: number, equipDepth: number, playerClearance: number, step: number = 20,
): { x: number; y: number; rotation: number; score: number }[] {
  const positions: { x: number; y: number; rotation: number; score: number }[] = [];
  const pts = room.points;
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const isWide = (maxX - minX) >= (maxY - minY);
  const longestDim = Math.max(equipWidth, equipDepth);
  const shortestDim = Math.min(equipWidth, equipDepth);

  if (isWide) {
    const rotation = equipWidth >= equipDepth ? 0 : 90;
    const xMargin = longestDim / 2 + playerClearance;
    const yMinMargin = shortestDim / 2 + CORRIDOR_WIDTH;
    const centerX = (minX + maxX) / 2;
    for (let y = minY + yMinMargin; y <= maxY - yMinMargin; y += step) {
      for (let x = minX + xMargin; x <= maxX - xMargin; x += step) {
        const wallProx = Math.min(y - minY, maxY - y);
        positions.push({ x, y, rotation, score: 50 + wallProx / 5 + Math.abs(x - centerX) / 20 });
      }
    }
  } else {
    const rotation = equipDepth >= equipWidth ? 0 : 90;
    const yMargin = longestDim / 2 + playerClearance;
    const xMinMargin = shortestDim / 2 + CORRIDOR_WIDTH;
    const centerY = (minY + maxY) / 2;
    for (let x = minX + xMinMargin; x <= maxX - xMinMargin; x += step) {
      for (let y = minY + yMargin; y <= maxY - yMargin; y += step) {
        const wallProx = Math.min(x - minX, maxX - x);
        positions.push({ x, y, rotation, score: 50 + wallProx / 5 + Math.abs(y - centerY) / 20 });
      }
    }
  }
  positions.sort((a, b) => a.score - b.score);
  return positions;
}

// ═══════════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════════

function makePlacement(equip: GameEquipment, x: number, y: number, rotation: number, w: number, d: number): PlacedEquipment {
  return {
    id: crypto.randomUUID(),
    equipmentId: equip.id,
    position: { x, y },
    rotation, name: equip.name,
    width: w, depth: d,
    safetyZone: equip.safetyZone,
    color: equip.color || "hsl(263, 85%, 68%)",
    height: equip.height,
    model3d: equip.model3d,
    model3dRotation: equip.model3dRotation,
    centerPlacement: equip.centerPlacement,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CIRCULATION PATH GENERATION
// ═══════════════════════════════════════════════════════════════════

export type CirculationSegment = { start: Point; end: Point; width: number };

function generateCirculationPath(room: Room, placed: PlacedEquipment[], corridorWidth: number): CirculationSegment[] {
  const segments: CirculationSegment[] = [];
  const pts = room.points;
  if (pts.length < 3 || placed.length === 0) return segments;
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const isWide = (maxX - minX) >= (maxY - minY);

  if (isWide) {
    const corridorY = (minY + maxY) / 2;
    segments.push({ start: { x: minX + corridorWidth, y: corridorY }, end: { x: maxX - corridorWidth, y: corridorY }, width: corridorWidth });
  } else {
    const corridorX = (minX + maxX) / 2;
    segments.push({ start: { x: corridorX, y: minY + corridorWidth }, end: { x: corridorX, y: maxY - corridorWidth }, width: corridorWidth });
  }
  return segments;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PLACEMENT ENGINE — 10 RULES HIERARCHY
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// PUBLIC TYPES — options, per-item report, backward-compatible result
// ═══════════════════════════════════════════════════════════════════

export type PlacementDensity = "confort" | "standard" | "max";

export type PlacementOptions = {
  density?: PlacementDensity;    // spacing multiplier
  groupByFamily?: boolean;       // keep same category together
  preserveExisting?: boolean;    // don't move existingPlacements
};

export type PlacementFailureReason =
  | "no_closed_room"
  | "no_wall_space"
  | "circulation_broken"
  | "too_large"
  | "unknown";

export type PlacementReportItem = {
  equipmentId: string;
  name: string;
  reason: PlacementFailureReason;
  message: string;
};

export type PlacementResult = {
  placed: PlacedEquipment[];
  notPlaced: GameEquipment[];
  circulation: CirculationSegment[];
  report: PlacementReportItem[];
};

const HIGH_IMPACT_RE = /simulat|simulateur|screen|ecran|écran|vr|racing|driving|shooter|arcade\s*geant/i;
const CRANE_RE = /grue|crane|pusher|prize|peluche|claw/i;

// ═══════════════════════════════════════════════════════════════════
// PUBLIC ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════

export function autoPlaceEquipment(
  selectedEquipments: GameEquipment[], rooms: Room[], doors: Door[], pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacedEquipment[] {
  return autoPlaceEquipmentWithReport(selectedEquipments, rooms, doors, pillars, existingPlacements).placed;
}

export function autoPlaceEquipmentWithReport(
  selectedEquipments: GameEquipment[],
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
  options: PlacementOptions = {},
): PlacementResult {
  const density: PlacementDensity = options.density ?? "standard";
  const groupByFamily = options.groupByFamily ?? true;
  const preserveExisting = options.preserveExisting ?? false;

  // Density multiplier acts on inter-different-ref gap only.
  const diffGap = density === "confort" ? 25 : density === "max" ? 5 : DIFFERENT_GAP;

  const report: PlacementReportItem[] = [];

  if (selectedEquipments.length === 0) {
    return { placed: [], notPlaced: [], circulation: [], report };
  }

  const closedRooms = rooms
    .filter(r => r.isClosed)
    .sort((a, b) => Math.abs(polygonSignedArea(b.points)) - Math.abs(polygonSignedArea(a.points)));

  if (closedRooms.length === 0) {
    for (const eq of selectedEquipments) {
      report.push({
        equipmentId: eq.id, name: eq.name,
        reason: "no_closed_room", message: "Aucune salle fermée dans le plan",
      });
    }
    return { placed: [], notPlaced: [...selectedEquipments], circulation: [], report };
  }

  const doorZones = getDoorExclusionZones(rooms, doors);
  const pillarZones = getPillarExclusionZones(pillars);

  const startingPlacements: PlacedEquipment[] = preserveExisting ? [...existingPlacements] : [];
  const placements: PlacedEquipment[] = [...startingPlacements];
  const newlyPlaced: PlacedEquipment[] = [];

  // Split center-placement from wall equipment (individual duplicates preserved)
  let pendingWall: GameEquipment[] = selectedEquipments.filter(e => !e.centerPlacement);
  let pendingCenter: GameEquipment[] = selectedEquipments.filter(e => e.centerPlacement);

  // ── Per-room placement ────────────────────────────────────────
  for (const room of closedRooms) {
    if (pendingWall.length === 0 && pendingCenter.length === 0) break;

    const walls = getRoomWalls(room, doors);
    if (walls.length === 0) continue;

    // ── Visibility scoring for each wall from the room's main door ──
    const roomDoors = doors.filter(d => d.roomId === room.id);
    const mainDoor = roomDoors.find(d => d.isMainDoor) || roomDoors[0];
    const wallVisibility = computeWallVisibility(room, walls, mainDoor);

    // ── Family grouping ──
    const families = groupWallEquipmentByFamily(pendingWall, groupByFamily);

    // Family placement order: high-impact first, then cranes, then rest by footprint.
    families.sort((a, b) => {
      const rank = (k: FamilyKind) => k === "highImpact" ? 0 : k === "crane" ? 1 : 2;
      if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
      const areaA = a.units.reduce((s, e) => s + e.width * e.depth, 0);
      const areaB = b.units.reduce((s, e) => s + e.width * e.depth, 0);
      return areaB - areaA;
    });

    // Track wall usage
    const wallUsed = new Map<number, number>();
    const wallDeepest = new Map<number, number>();
    for (const w of walls) { wallUsed.set(w.edgeIndex, 0); wallDeepest.set(w.edgeIndex, 0); }

    const placedThisRoom = new Set<GameEquipment>();

    // Cache last circulation-OK snapshot count to reduce checks.
    let placedSinceCheck = 0;

    const circulationOK = (): boolean => {
      try {
        const r = computeCirculation(rooms, doors, pillars, placements);
        return r.unreachableCount === 0;
      } catch {
        return true; // don't fail placement on circulation error
      }
    };

    for (const family of families) {
      // Sort units inside family: same-ref first, then by footprint desc
      const familyUnits = [...family.units].sort((a, b) => {
        if (a.id === b.id) return 0;
        return (b.width * b.depth) - (a.width * a.depth);
      });

      // Preferred wall order for this family
      const wallOrder = orderWallsForFamily(walls, family.kind, wallVisibility, mainDoor);

      let currentWall: WallSegment | null = null;
      let lastPlacement: { x: number; y: number; rotation: number; w: number; d: number } | null = null;
      let lastRefId: string | null = null;

      for (let ui = 0; ui < familyUnits.length; ui++) {
        const equip = familyUnits[ui];
        const curW = equip.width;
        const curD = equip.depth;
        const sameRefAsLast = lastRefId === equip.id;
        const gap = sameRefAsLast ? SAME_REF_GAP : diffGap;

        // Guard: item wider than any wall — no chance
        const longestWall = Math.max(...walls.map(w => w.length));
        if (curW > longestWall - WALL_MARGIN * 2 && curD > longestWall - WALL_MARGIN * 2) {
          report.push({
            equipmentId: equip.id, name: equip.name,
            reason: "too_large", message: `Trop grand (${curW}×${curD}cm) pour tous les murs de "${room.name || "la salle"}"`,
          });
          continue;
        }

        let placedOk = false;

        // STEP A — extend current run on current wall (adjacency)
        if (currentWall && lastPlacement) {
          const adj = generateAdjacentPositions(
            lastPlacement.x, lastPlacement.y, lastPlacement.rotation,
            lastPlacement.w, lastPlacement.d, curW, curD, gap,
          );
          for (const pos of adj) {
            if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, gap, room, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
              placements.push(p); newlyPlaced.push(p); placedThisRoom.add(equip);
              wallUsed.set(currentWall.edgeIndex, (wallUsed.get(currentWall.edgeIndex) || 0) + curW + gap);
              wallDeepest.set(currentWall.edgeIndex, Math.max(wallDeepest.get(currentWall.edgeIndex) || 0, curD));
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD };
              lastRefId = equip.id;
              placedOk = true;
              break;
            }
          }
        }

        // STEP B — fresh spot on current wall
        if (!placedOk && currentWall) {
          const positions = generateWallPositions(currentWall, curW, curD, 5, false);
          positions.sort((a, b) => a.score - b.score);
          for (const pos of positions) {
            if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, diffGap, room, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
              placements.push(p); newlyPlaced.push(p); placedThisRoom.add(equip);
              wallUsed.set(currentWall.edgeIndex, (wallUsed.get(currentWall.edgeIndex) || 0) + curW);
              wallDeepest.set(currentWall.edgeIndex, Math.max(wallDeepest.get(currentWall.edgeIndex) || 0, curD));
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD };
              lastRefId = equip.id;
              placedOk = true;
              break;
            }
          }
        }

        // STEP C — CONTINUE the run on the next preferred wall
        if (!placedOk) {
          for (const wall of wallOrder) {
            if (currentWall && wall.edgeIndex === currentWall.edgeIndex) continue;
            const positions = generateWallPositions(wall, curW, curD, 5, true);
            positions.sort((a, b) => a.score - b.score);
            let hit = false;
            for (const pos of positions) {
              if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, diffGap, room, doorZones, pillarZones, placements)) {
                const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
                placements.push(p); newlyPlaced.push(p); placedThisRoom.add(equip);
                wallUsed.set(wall.edgeIndex, (wallUsed.get(wall.edgeIndex) || 0) + curW);
                wallDeepest.set(wall.edgeIndex, Math.max(wallDeepest.get(wall.edgeIndex) || 0, curD));
                lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD };
                lastRefId = equip.id;
                currentWall = wall;
                hit = true; break;
              }
            }
            if (hit) { placedOk = true; break; }
          }
        }

        if (!placedOk) {
          // Leave in pendingWall so another room may take it.
          continue;
        }

        // STEP D — circulation feasibility check (batched every 4 placements)
        placedSinceCheck++;
        const isBoundary = ui === familyUnits.length - 1 || placedSinceCheck >= 4;
        if (isBoundary) {
          placedSinceCheck = 0;
          if (!circulationOK()) {
            // Roll back the LAST placement made in this run.
            const last = newlyPlaced.pop();
            if (last) {
              const idx = placements.lastIndexOf(last);
              if (idx !== -1) placements.splice(idx, 1);
              placedThisRoom.delete(equip);
              report.push({
                equipmentId: equip.id, name: equip.name,
                reason: "circulation_broken",
                message: "Retiré : le placement casse la circulation PMR 1,20 m",
              });
            }
            // Force next unit onto a different wall
            currentWall = null;
            lastPlacement = null;
            lastRefId = null;
          }
        }
      }
    }

    // Items not placed in this room go to the next room.
    pendingWall = pendingWall.filter(e => !placedThisRoom.has(e));

    // ── Center placement (islands with 1.20 m passage) ──
    if (pendingCenter.length > 0) {
      const placedCenterThisRoom = new Set<GameEquipment>();
      const byId = new Map<string, { equip: GameEquipment; qty: number }>();
      for (const eq of pendingCenter) {
        const cur = byId.get(eq.id);
        if (cur) cur.qty++;
        else byId.set(eq.id, { equip: eq, qty: 1 });
      }

      let centerLast: { x: number; y: number } | null = null;
      for (const { equip, qty } of byId.values()) {
        const playerClearance = equip.playerClearance || 100;
        for (let i = 0; i < qty; i++) {
          const positions = generateCenterPlacementPositions(room, equip.width, equip.depth, playerClearance, 20);
          if (centerLast) {
            positions.sort((a, b) =>
              Math.hypot(a.x - centerLast!.x, a.y - centerLast!.y) -
              Math.hypot(b.x - centerLast!.x, b.y - centerLast!.y)
            );
          }
          let placedThis = false;
          for (const pos of positions) {
            if (isCenterPlacementValid(pos.x, pos.y, equip.width, equip.depth, pos.rotation, playerClearance, room, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, equip.width, equip.depth);
              placements.push(p); newlyPlaced.push(p);
              centerLast = { x: pos.x, y: pos.y };
              placedCenterThisRoom.add(equip);
              placedThis = true;
              break;
            }
          }
          if (!placedThis) {
            // Try again in next room
            break;
          }
        }
      }
      pendingCenter = pendingCenter.filter(e => !placedCenterThisRoom.has(e));
    }
  }

  // Anything still pending after all rooms → notPlaced
  const notPlaced: GameEquipment[] = [...pendingWall, ...pendingCenter];
  for (const eq of notPlaced) {
    // Avoid duplicate reports for items already logged (circulation/too_large)
    if (!report.some(r => r.equipmentId === eq.id && (r.reason === "circulation_broken" || r.reason === "too_large"))) {
      report.push({
        equipmentId: eq.id, name: eq.name,
        reason: "no_wall_space",
        message: "Aucune position libre trouvée dans les salles disponibles",
      });
    }
  }

  // Final circulation for return
  const circResult = (() => {
    try { return computeCirculation(rooms, doors, pillars, placements).segments; }
    catch { return [] as CirculationSegment[]; }
  })();

  return { placed: newlyPlaced, notPlaced, circulation: circResult, report };
}

// ═══════════════════════════════════════════════════════════════════
// FAMILY GROUPING & VISIBILITY
// ═══════════════════════════════════════════════════════════════════

type FamilyKind = "highImpact" | "crane" | "normal";
type FamilyGroup = { key: string; kind: FamilyKind; units: GameEquipment[] };

function familyKindOf(eq: GameEquipment): FamilyKind {
  const s = `${eq.category || ""} ${eq.name || ""}`.toLowerCase();
  if (HIGH_IMPACT_RE.test(s)) return "highImpact";
  if (CRANE_RE.test(s)) return "crane";
  return "normal";
}

function groupWallEquipmentByFamily(items: GameEquipment[], groupByFamily: boolean): FamilyGroup[] {
  const map = new Map<string, FamilyGroup>();
  for (const eq of items) {
    const key = groupByFamily
      ? (eq.category || "autre").toLowerCase().replace(/s$/, "")
      : `__ref_${eq.id}`;
    const kind = familyKindOf(eq);
    if (!map.has(key)) map.set(key, { key, kind, units: [] });
    map.get(key)!.units.push(eq);
    // Upgrade family kind: any high-impact member promotes the group
    const g = map.get(key)!;
    if (kind === "highImpact") g.kind = "highImpact";
    else if (kind === "crane" && g.kind === "normal") g.kind = "crane";
  }
  return [...map.values()];
}

/**
 * Score each wall by how visible it is from the room's main door.
 * Higher = more visible. Door wall itself is penalised.
 */
function computeWallVisibility(
  room: Room,
  walls: WallSegment[],
  mainDoor: Door | undefined,
): Map<number, number> {
  const out = new Map<number, number>();
  if (!mainDoor) {
    for (const w of walls) out.set(w.edgeIndex, w.length);
    return out;
  }
  const a = room.points[mainDoor.edgeIndex];
  const b = room.points[(mainDoor.edgeIndex + 1) % room.points.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const dLen = Math.hypot(dx, dy) || 1;
  const doorNx = -dy / dLen, doorNy = dx / dLen; // inward normal (either sign)
  const doorMid: Point = {
    x: a.x + dx * mainDoor.positionRatio,
    y: a.y + dy * mainDoor.positionRatio,
  };

  for (const w of walls) {
    if (w.edgeIndex === mainDoor.edgeIndex) { out.set(w.edgeIndex, -1000); continue; }
    const wm = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
    const vx = wm.x - doorMid.x, vy = wm.y - doorMid.y;
    const vLen = Math.hypot(vx, vy) || 1;
    // Alignment with door normal (facing the door) — the wall opposite the door wins.
    const align = Math.abs(vx * doorNx + vy * doorNy) / vLen;
    const score = align * 200 + w.length * 0.1 - vLen * 0.05;
    out.set(w.edgeIndex, score);
  }
  return out;
}

function orderWallsForFamily(
  walls: WallSegment[],
  kind: FamilyKind,
  visibility: Map<number, number>,
  mainDoor: Door | undefined,
): WallSegment[] {
  if (kind === "highImpact") {
    return [...walls].sort((a, b) =>
      (visibility.get(b.edgeIndex) || 0) - (visibility.get(a.edgeIndex) || 0));
  }
  if (kind === "crane" && mainDoor) {
    // Adjacent walls to the door
    return [...walls].sort((a, b) => {
      const da = Math.min(
        Math.abs(a.edgeIndex - mainDoor.edgeIndex),
        walls.length - Math.abs(a.edgeIndex - mainDoor.edgeIndex),
      );
      const db = Math.min(
        Math.abs(b.edgeIndex - mainDoor.edgeIndex),
        walls.length - Math.abs(b.edgeIndex - mainDoor.edgeIndex),
      );
      if (da !== db) return da - db;
      return b.length - a.length;
    });
  }
  return [...walls].sort((a, b) => b.length - a.length);
}

