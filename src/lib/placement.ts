import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { DOOR_EXCLUSION_DEPTH } from "@/types/equipment";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const CORRIDOR_WIDTH = 140; // Rule 1: 1.4m minimum corridor
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

export type PlacementResult = {
  placed: PlacedEquipment[];
  notPlaced: GameEquipment[];
  circulation: CirculationSegment[];
};

export function autoPlaceEquipment(
  selectedEquipments: GameEquipment[], rooms: Room[], doors: Door[], pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacedEquipment[] {
  return autoPlaceEquipmentWithReport(selectedEquipments, rooms, doors, pillars, existingPlacements).placed;
}

export function autoPlaceEquipmentWithReport(
  selectedEquipments: GameEquipment[], rooms: Room[], doors: Door[], pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacementResult {
  if (rooms.length === 0 || selectedEquipments.length === 0) {
    return { placed: [], notPlaced: selectedEquipments, circulation: [] };
  }

  // Find largest closed room
  let bestRoom: Room | null = null;
  let bestArea = 0;
  for (const room of rooms) {
    if (!room.isClosed) continue;
    const area = Math.abs(polygonSignedArea(room.points));
    if (area > bestArea) { bestArea = area; bestRoom = room; }
  }
  if (!bestRoom) return { placed: [], notPlaced: selectedEquipments, circulation: [] };

  const doorZones = getDoorExclusionZones(rooms, doors);
  const pillarZones = getPillarExclusionZones(pillars);
  const walls = getRoomWalls(bestRoom, doors);
  const wallsByLength = [...walls].sort((a, b) => b.length - a.length);

  console.log(`[placement] Room: ${walls.length} walls, area=${bestArea.toFixed(0)}`);

  const placements: PlacedEquipment[] = [...existingPlacements];
  const result: PlacedEquipment[] = [];
  const notPlaced: GameEquipment[] = [];

  // ── Separate center-placement (tables) from wall-based equipment ──
  const centerEquipments: GameEquipment[] = [];
  const wallEquipments: GameEquipment[] = [];
  for (const equip of selectedEquipments) {
    if (equip.centerPlacement) centerEquipments.push(equip);
    else wallEquipments.push(equip);
  }

  // ── Group by reference ID, then by category ──
  const byEquipmentId = new Map<string, { equip: GameEquipment; count: number }>();
  for (const equip of wallEquipments) {
    const existing = byEquipmentId.get(equip.id);
    if (existing) existing.count++;
    else byEquipmentId.set(equip.id, { equip, count: 1 });
  }

  const byCategory = new Map<string, { equip: GameEquipment; count: number }[]>();
  for (const group of byEquipmentId.values()) {
    const cat = (group.equip.category || "autre").toLowerCase().replace(/s$/, "");
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(group);
  }

  // Rule 8: Sort categories by total footprint area (largest first)
  const sortedCategories = Array.from(byCategory.entries()).sort((a, b) => {
    const areaA = a[1].reduce((s, g) => s + g.equip.width * g.equip.depth * g.count, 0);
    const areaB = b[1].reduce((s, g) => s + g.equip.width * g.equip.depth * g.count, 0);
    return areaB - areaA;
  });

  // Track remaining capacity per wall for Rule 7
  const wallUsedLength = new Map<number, number>(); // edgeIndex → total equipment width placed
  for (const wall of walls) wallUsedLength.set(wall.edgeIndex, 0);

  // Track deepest equipment per wall for Rule 5 (straight corridor)
  const wallMaxDepth = new Map<number, number>();
  for (const wall of walls) wallMaxDepth.set(wall.edgeIndex, 0);

  const step = 5;

  // ════════════════════════════════════════════════════════════════
  // PHASE 1: Wall-backed placement (Rules 1-8)
  // ════════════════════════════════════════════════════════════════
  
  const wallNotPlaced: GameEquipment[] = []; // equipment that couldn't fit on walls → Phase 2

  for (const [category, equipmentGroups] of sortedCategories) {
    console.log(`[placement] Category: "${category}" (${equipmentGroups.length} refs)`);

    // Sort groups by area within category (largest first)
    const sortedGroups = [...equipmentGroups].sort((a, b) =>
      (b.equip.width * b.equip.depth * b.count) - (a.equip.width * a.equip.depth * a.count)
    );

    // Rule 7: Determine best wall for this category
    // Check if the entire category fits on the remaining space of the current wall,
    // otherwise start on the next wall with most remaining space
    let categoryWallEdge: number | undefined = undefined;
    let categoryLastPlacement: {
      x: number; y: number; rotation: number; w: number; d: number; wallEdgeIndex?: number;
    } | null = null;

    for (const group of sortedGroups) {
      const equip = group.equip;
      const count = group.count;
      let sameRefWallEdgeIndex: number | undefined = undefined;

      for (let i = 0; i < count; i++) {
        let placed = false;
        const curW = equip.width;
        const curD = equip.depth;
        const lastPlacement = categoryLastPlacement;

        // ── STEP 1: Adjacent to last placement (Rule 3: same ref together) ──
        if (lastPlacement) {
          const adjPositions = generateAdjacentPositions(
            lastPlacement.x, lastPlacement.y, lastPlacement.rotation,
            lastPlacement.w, lastPlacement.d, curW, curD, SAME_REF_GAP,
          );
          for (const pos of adjPositions) {
            if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom!, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
              placements.push(p); result.push(p);
              categoryLastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD, wallEdgeIndex: lastPlacement.wallEdgeIndex };
              if (sameRefWallEdgeIndex === undefined && lastPlacement.wallEdgeIndex !== undefined) sameRefWallEdgeIndex = lastPlacement.wallEdgeIndex;
              wallUsedLength.set(lastPlacement.wallEdgeIndex!, (wallUsedLength.get(lastPlacement.wallEdgeIndex!) || 0) + curW);
              wallMaxDepth.set(lastPlacement.wallEdgeIndex!, Math.max(wallMaxDepth.get(lastPlacement.wallEdgeIndex!) || 0, curD));
              placed = true;
              break;
            }
          }
        }
        if (placed) continue;

        // ── STEP 2: Same wall as last placement (Rule 3 + Rule 7) ──
        if (lastPlacement?.wallEdgeIndex !== undefined) {
          const sameWall = walls.find(w => w.edgeIndex === lastPlacement.wallEdgeIndex);
          if (sameWall) {
            const positions = generateWallPositions(sameWall, curW, curD, step);
            positions.sort((a, b) => {
              const dA = Math.hypot(a.x - lastPlacement.x, a.y - lastPlacement.y);
              const dB = Math.hypot(b.x - lastPlacement.x, b.y - lastPlacement.y);
              return dA - dB;
            });
            for (const pos of positions) {
              if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom!, doorZones, pillarZones, placements)) {
                const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
                placements.push(p); result.push(p);
                categoryLastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD, wallEdgeIndex: sameWall.edgeIndex };
                if (sameRefWallEdgeIndex === undefined) sameRefWallEdgeIndex = sameWall.edgeIndex;
                wallUsedLength.set(sameWall.edgeIndex, (wallUsedLength.get(sameWall.edgeIndex) || 0) + curW);
                wallMaxDepth.set(sameWall.edgeIndex, Math.max(wallMaxDepth.get(sameWall.edgeIndex) || 0, curD));
                placed = true;
                break;
              }
            }
          }
        }
        if (placed) continue;

        // ── STEP 2b: Force same-ref items on same wall (Rule 3 priority) ──
        if (i > 0 && sameRefWallEdgeIndex !== undefined) {
          const refWall = walls.find(w => w.edgeIndex === sameRefWallEdgeIndex);
          if (refWall) {
            const positions = generateWallPositions(refWall, curW, curD, 2); // finer step
            const sameRefPlacements = placements.filter(p => p.equipmentId === equip.id);
            const centroid = sameRefPlacements.length > 0
              ? { x: sameRefPlacements.reduce((s, p) => s + p.position.x, 0) / sameRefPlacements.length,
                  y: sameRefPlacements.reduce((s, p) => s + p.position.y, 0) / sameRefPlacements.length }
              : null;
            if (centroid) positions.sort((a, b) => Math.hypot(a.x - centroid.x, a.y - centroid.y) - Math.hypot(b.x - centroid.x, b.y - centroid.y));
            for (const pos of positions) {
              if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom!, doorZones, pillarZones, placements)) {
                const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
                placements.push(p); result.push(p);
                categoryLastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD, wallEdgeIndex: refWall.edgeIndex };
                wallUsedLength.set(refWall.edgeIndex, (wallUsedLength.get(refWall.edgeIndex) || 0) + curW);
                wallMaxDepth.set(refWall.edgeIndex, Math.max(wallMaxDepth.get(refWall.edgeIndex) || 0, curD));
                placed = true;
                console.log(`[placement] Same-ref forced ${equip.name} on wall ${refWall.edgeIndex}`);
                break;
              }
            }
          }
        }
        if (placed) continue;

        // ── STEP 3: All walls scored (Rules 4, 7, 8) ──
        {
          const allWallPos: { x: number; y: number; rotation: number; score: number; wallEdgeIndex: number }[] = [];
          for (const wall of wallsByLength) {
            const isVeryFirst = placements.length === 0;
            const positions = generateWallPositions(wall, curW, curD, step, isVeryFirst);
            for (const pos of positions) {
              let penalty = 0;

              // Rule 3: massive penalty for same-ref on different wall
              if (i > 0 && sameRefWallEdgeIndex !== undefined && wall.edgeIndex !== sameRefWallEdgeIndex) {
                penalty += 50000;
              }

              // Rule 7: penalty for splitting category across walls
              if (categoryWallEdge !== undefined && wall.edgeIndex !== categoryWallEdge) {
                // Check if this category can still fit on the category wall
                const catWall = walls.find(w => w.edgeIndex === categoryWallEdge);
                const used = wallUsedLength.get(categoryWallEdge) || 0;
                const remaining = catWall ? catWall.length - used - WALL_MARGIN * 2 : 0;
                if (remaining >= curW) {
                  penalty += 3000; // strong penalty — category wall has space
                } else {
                  penalty += 200; // mild penalty — category wall is full, acceptable to move
                }
              }

              // Proximity to last placement
              if (categoryLastPlacement) {
                const dist = Math.hypot(pos.x - categoryLastPlacement.x, pos.y - categoryLastPlacement.y);
                penalty += dist * 2;
              }

              allWallPos.push({ x: pos.x, y: pos.y, rotation: pos.rotation, score: pos.score + penalty, wallEdgeIndex: wall.edgeIndex });
            }
          }
          allWallPos.sort((a, b) => a.score - b.score);

          for (const pos of allWallPos) {
            if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom!, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
              placements.push(p); result.push(p);
              categoryLastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD, wallEdgeIndex: pos.wallEdgeIndex };
              if (sameRefWallEdgeIndex === undefined) sameRefWallEdgeIndex = pos.wallEdgeIndex;
              if (categoryWallEdge === undefined) categoryWallEdge = pos.wallEdgeIndex;
              wallUsedLength.set(pos.wallEdgeIndex, (wallUsedLength.get(pos.wallEdgeIndex) || 0) + curW);
              wallMaxDepth.set(pos.wallEdgeIndex, Math.max(wallMaxDepth.get(pos.wallEdgeIndex) || 0, curD));
              placed = true;
              console.log(`[placement] Placed ${equip.name} on wall ${pos.wallEdgeIndex} at (${pos.x.toFixed(0)},${pos.y.toFixed(0)})`);
              break;
            }
          }
        }
        if (placed) continue;

        // Could not place on any wall → defer to Phase 2 (second row)
        console.log(`[placement] ${equip.name} (${i + 1}/${count}) — no wall space, deferred to Phase 2`);
        wallNotPlaced.push(equip);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 2: Second-row placement (Rule 2 extended)
  // Equipment faces the opposite side of the corridor, creating an aisle.
  // Wall equipment corridor takes priority.
  // ════════════════════════════════════════════════════════════════

  if (wallNotPlaced.length > 0) {
    console.log(`[placement] Phase 2: ${wallNotPlaced.length} items for second-row placement`);

    // Group second-row items by ref for adjacency
    const secondRowByRef = new Map<string, GameEquipment[]>();
    for (const equip of wallNotPlaced) {
      if (!secondRowByRef.has(equip.id)) secondRowByRef.set(equip.id, []);
      secondRowByRef.get(equip.id)!.push(equip);
    }

    let secondRowLast: { x: number; y: number; rotation: number; w: number; d: number; wallEdgeIndex?: number } | null = null;

    for (const [refId, equips] of secondRowByRef) {
      let refWallEdge: number | undefined = undefined;

      for (const equip of equips) {
        let placed = false;
        const curW = equip.width;
        const curD = equip.depth;

        // Try adjacent to last second-row placement first
        if (secondRowLast && refWallEdge !== undefined) {
          const adjPositions = generateAdjacentPositions(
            secondRowLast.x, secondRowLast.y, secondRowLast.rotation,
            secondRowLast.w, secondRowLast.d, curW, curD, SAME_REF_GAP,
          );
          for (const pos of adjPositions) {
            if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom!, doorZones, pillarZones, placements, true)) {
              // Verify we don't block any wall equipment's front zone
              let blocksWallCorridor = false;
              for (const pe of placements) {
                if (pe.centerPlacement) continue;
                const fz = getFrontClearanceZone(pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation, CORRIDOR_WIDTH);
                if (rectsOverlap(fz.cx, fz.cy, fz.w, fz.d, fz.rot, pos.x, pos.y, curW, curD, pos.rotation)) {
                  blocksWallCorridor = true; break;
                }
              }
              if (!blocksWallCorridor) {
                const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
                placements.push(p); result.push(p);
                secondRowLast = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD, wallEdgeIndex: refWallEdge };
                placed = true;
                break;
              }
            }
          }
        }
        if (placed) continue;

        // Generate second-row positions along all walls
        const allSecondRowPos: { x: number; y: number; rotation: number; rotated90: boolean; score: number; wallEdgeIndex: number }[] = [];

        for (const wall of wallsByLength) {
          const maxDepth = wallMaxDepth.get(wall.edgeIndex) || 60; // default 60cm if no wall equipment
          const positions = generateSecondRowPositions(wall, curW, curD, maxDepth, step);
          for (const pos of positions) {
            let penalty = 0;
            // Prefer same wall as other same-ref items
            if (refWallEdge !== undefined && wall.edgeIndex !== refWallEdge) penalty += 50000;
            // Proximity to last placement
            if (secondRowLast) penalty += Math.hypot(pos.x - secondRowLast.x, pos.y - secondRowLast.y) * 2;
            allSecondRowPos.push({ ...pos, score: pos.score + penalty, wallEdgeIndex: wall.edgeIndex });
          }
        }
        allSecondRowPos.sort((a, b) => a.score - b.score);

        for (const pos of allSecondRowPos) {
          // Basic validity (inside room, no physical overlaps)
          if (!isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom!, doorZones, pillarZones, placements, true)) continue;

          // Rule 2 priority: check that we don't block any wall-backed equipment's corridor
          let blocksWallCorridor = false;
          for (const pe of placements) {
            if (pe.centerPlacement) continue;
            // Check if this pe is a wall-backed equipment (not already a second-row item)
            const fz = getFrontClearanceZone(pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation, CORRIDOR_WIDTH);
            if (rectsOverlap(fz.cx, fz.cy, fz.w, fz.d, fz.rot, pos.x, pos.y, curW, curD, pos.rotation)) {
              blocksWallCorridor = true;
              break;
            }
          }

          if (blocksWallCorridor && !pos.rotated90) {
            // Try to find the 90° rotated version on same wall at similar position
            continue; // the 90° positions are already in the sorted list with higher score
          }
          if (blocksWallCorridor) continue; // even 90° blocks → skip

          const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
          placements.push(p); result.push(p);
          secondRowLast = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD, wallEdgeIndex: pos.wallEdgeIndex };
          if (refWallEdge === undefined) refWallEdge = pos.wallEdgeIndex;
          placed = true;
          console.log(`[placement] Second-row placed ${equip.name} on wall ${pos.wallEdgeIndex} rot90=${pos.rotated90}`);
          break;
        }

        if (!placed) {
          console.warn(`[placement] Could not place: ${equip.name} — no wall or second-row space`);
          notPlaced.push(equip);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 3: Center-placement tables (Rule 9 — last)
  // ════════════════════════════════════════════════════════════════

  {
    const byId = new Map<string, { equip: GameEquipment; count: number }>();
    for (const equip of centerEquipments) {
      const existing = byId.get(equip.id);
      if (existing) existing.count++;
      else byId.set(equip.id, { equip, count: 1 });
    }

    let centerLast: { x: number; y: number; rotation: number; w: number; d: number } | null = null;
    for (const group of byId.values()) {
      const equip = group.equip;
      const playerClearance = equip.playerClearance || 100;
      for (let i = 0; i < group.count; i++) {
        const w = equip.width, d = equip.depth;
        const centerPositions = generateCenterPlacementPositions(bestRoom!, w, d, playerClearance, step);
        if (centerLast) {
          centerPositions.sort((a, b) =>
            Math.hypot(a.x - centerLast!.x, a.y - centerLast!.y) - Math.hypot(b.x - centerLast!.x, b.y - centerLast!.y)
          );
        }
        let placed = false;
        for (const pos of centerPositions) {
          if (isCenterPlacementValid(pos.x, pos.y, w, d, pos.rotation, playerClearance, bestRoom!, doorZones, pillarZones, placements)) {
            const p = makePlacement(equip, pos.x, pos.y, pos.rotation, w, d);
            placements.push(p); result.push(p);
            centerLast = { x: pos.x, y: pos.y, rotation: pos.rotation, w, d };
            placed = true;
            console.log(`[placement] Center-placed ${equip.name} at (${pos.x.toFixed(0)},${pos.y.toFixed(0)})`);
            break;
          }
        }
        if (!placed) {
          console.warn(`[placement] Could not center-place: ${equip.name}`);
          notPlaced.push(equip);
        }
      }
    }
  }

  const circulation = generateCirculationPath(bestRoom!, result, CORRIDOR_WIDTH);
  return { placed: result, notPlaced, circulation };
}
