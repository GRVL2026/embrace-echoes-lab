import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { DOOR_EXCLUSION_DEPTH } from "@/types/equipment";

// Corridor width for accessibility
const CORRIDOR_WIDTH = 140; // 1.4m
// Gap between same-reference equipment
const SAME_REF_GAP = 5; // 5cm
// Gap between different equipment
const DIFFERENT_GAP = 10; // 10cm
// Margin from wall (back of equipment to wall)
const WALL_MARGIN = 5; // 5cm
// Gap between corridor and front of equipment
const CORRIDOR_FRONT_GAP = 2; // 2cm
// Minimum face-to-face distance (Rule 4: 1 corridor width)
const MIN_FACE_TO_FACE = CORRIDOR_WIDTH; // 1.40m

/** Check if a point is inside a polygon (ray-casting) */
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

/** Check if a rectangle (cx, cy, w, d, rotation) is fully inside a polygon */
function rectInsidePolygon(cx: number, cy: number, w: number, d: number, rot: number, polygon: Point[]): boolean {
  const corners = getRectCorners(cx, cy, w, d, rot);
  return corners.every(c => pointInPolygon(c, polygon));
}

/** Get 4 corners of a rotated rectangle */
function getRectCorners(cx: number, cy: number, w: number, d: number, rot: number): Point[] {
  const hw = w / 2, hd = d / 2;
  const cos = Math.cos(rot * Math.PI / 180);
  const sin = Math.sin(rot * Math.PI / 180);
  const offsets = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  return offsets.map(o => ({
    x: cx + o.x * cos - o.y * sin,
    y: cy + o.x * sin + o.y * cos,
  }));
}

/** Check if two rotated rectangles overlap (SAT) */
function rectsOverlap(
  ax: number, ay: number, aw: number, ad: number, aRot: number,
  bx: number, by: number, bw: number, bd: number, bRot: number,
): boolean {
  const cornersA = getRectCorners(ax, ay, aw, ad, aRot);
  const cornersB = getRectCorners(bx, by, bw, bd, bRot);
  return satOverlap(cornersA, cornersB);
}

function satOverlap(cornersA: Point[], cornersB: Point[]): boolean {
  const allCorners = [cornersA, cornersB];
  for (const corners of allCorners) {
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      const edge = { x: corners[j].x - corners[i].x, y: corners[j].y - corners[i].y };
      const axis = { x: -edge.y, y: edge.x };
      let minA = Infinity, maxA = -Infinity;
      for (const c of cornersA) {
        const proj = c.x * axis.x + c.y * axis.y;
        minA = Math.min(minA, proj);
        maxA = Math.max(maxA, proj);
      }
      let minB = Infinity, maxB = -Infinity;
      for (const c of cornersB) {
        const proj = c.x * axis.x + c.y * axis.y;
        minB = Math.min(minB, proj);
        maxB = Math.max(maxB, proj);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

/** Get door exclusion zone as a rectangle in world coords */
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

/** Get pillar exclusion zones */
function getPillarExclusionZones(pillars: Pillar[]): { cx: number; cy: number; w: number; d: number; rot: number }[] {
  return pillars.map(p => ({
    cx: p.position.x,
    cy: p.position.y,
    w: p.width + 20,
    d: p.depth + 20,
    rot: p.rotation || 0,
  }));
}

/** Get the front direction vector for equipment at given rotation */
function getFrontDirection(rot: number): { x: number; y: number } {
  const rad = rot * Math.PI / 180;
  return { x: -Math.sin(rad), y: Math.cos(rad) };
}

/** RULE 2: Get the front clearance zone as a CONE (trapezoid) approximated by a rectangle
 * that widens slightly as it extends outward from the front face.
 * Uses full equipment width + 10% expansion per side at the far end. */
function getFrontClearanceZone(
  cx: number, cy: number, w: number, d: number, rot: number, clearanceDepth: number,
): { cx: number; cy: number; w: number; d: number; rot: number } {
  const front = getFrontDirection(rot);
  // Center of clearance zone: shifted forward from equipment center
  const zoneCx = cx + front.x * (d / 2 + clearanceDepth / 2);
  const zoneCy = cy + front.y * (d / 2 + clearanceDepth / 2);
  // Cone: widen the zone by 20% of width (10% each side) to catch diagonal approaches
  const coneWidth = w * 1.2;
  return { cx: zoneCx, cy: zoneCy, w: coneWidth, d: clearanceDepth, rot };
}

/** RULE 4: Check face-to-face distance. If two equipment face each other,
 * they must be at least MIN_FACE_TO_FACE apart (measured between front faces). */
function checkFaceToFace(
  cx: number, cy: number, w: number, d: number, rot: number,
  existingPlacements: PlacedEquipment[],
): boolean {
  const newFront = getFrontDirection(rot);
  const newFrontCenterX = cx + newFront.x * (d / 2);
  const newFrontCenterY = cy + newFront.y * (d / 2);

  for (const pe of existingPlacements) {
    const existFront = getFrontDirection(pe.rotation);
    const existFrontCenterX = pe.position.x + existFront.x * (pe.depth / 2);
    const existFrontCenterY = pe.position.y + existFront.y * (pe.depth / 2);

    // Check if they roughly face each other (dot product of front directions < -0.5)
    const dot = newFront.x * existFront.x + newFront.y * existFront.y;
    if (dot > -0.5) continue; // Not facing each other

    // Check if they're roughly aligned (front-to-front axis matches facing direction)
    const dx = existFrontCenterX - newFrontCenterX;
    const dy = existFrontCenterY - newFrontCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;

    // Check alignment: the vector between fronts should be roughly along the front direction
    const alignDot = Math.abs((dx / dist) * newFront.x + (dy / dist) * newFront.y);
    if (alignDot < 0.5) continue; // Not aligned

    // They face each other and are aligned — check distance
    if (dist < MIN_FACE_TO_FACE) {
      return false;
    }
  }
  return true;
}

/** Check if an equipment placement is valid */
function isPlacementValid(
  cx: number, cy: number, w: number, d: number, rot: number, gap: number,
  room: Room,
  doorZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  pillarZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  existingPlacements: PlacedEquipment[],
  debug: boolean = false,
): boolean {
  // Must be inside room
  if (!rectInsidePolygon(cx, cy, w, d, rot, room.points)) {
    if (debug) console.log(`[placement] OUTSIDE room at (${cx.toFixed(0)},${cy.toFixed(0)}) ${w}x${d} rot=${rot.toFixed(0)}`);
    return false;
  }
  // Must not overlap door exclusion zones
  for (const dz of doorZones) {
    if (rectsOverlap(cx, cy, w, d, rot, dz.cx, dz.cy, dz.w, dz.d, dz.rot)) {
      if (debug) console.log(`[placement] DOOR overlap at (${cx.toFixed(0)},${cy.toFixed(0)})`);
      return false;
    }
  }
  // Must not overlap pillars
  for (const pz of pillarZones) {
    if (rectsOverlap(cx, cy, w + 20, d + 20, rot, pz.cx, pz.cy, pz.w, pz.d, pz.rot)) {
      if (debug) console.log(`[placement] PILLAR overlap at (${cx.toFixed(0)},${cy.toFixed(0)})`);
      return false;
    }
  }
  // Must not overlap other equipment (with gap)
  for (const pe of existingPlacements) {
    if (rectsOverlap(cx, cy, w + gap, d + gap, rot, pe.position.x, pe.position.y, pe.width + gap, pe.depth + gap, pe.rotation)) {
      if (debug) console.log(`[placement] EQUIP overlap with ${pe.name} at (${cx.toFixed(0)},${cy.toFixed(0)})`);
      return false;
    }
  }

  // ── RULE 2: Front clearance zone (cone) must not be blocked ──
  const newFrontZone = getFrontClearanceZone(cx, cy, w, d, rot, CORRIDOR_WIDTH);
  for (const pe of existingPlacements) {
    if (rectsOverlap(newFrontZone.cx, newFrontZone.cy, newFrontZone.w, newFrontZone.d, newFrontZone.rot,
      pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation)) {
      if (debug) console.log(`[placement] FRONT BLOCKED by ${pe.name} at (${cx.toFixed(0)},${cy.toFixed(0)})`);
      return false;
    }
  }

  // ── RULE 2 REVERSE: New equipment must not block the front of any existing equipment ──
  for (const pe of existingPlacements) {
    const existingFrontZone = getFrontClearanceZone(
      pe.position.x, pe.position.y, pe.width, pe.depth, pe.rotation, CORRIDOR_WIDTH
    );
    if (rectsOverlap(existingFrontZone.cx, existingFrontZone.cy, existingFrontZone.w, existingFrontZone.d, existingFrontZone.rot,
      cx, cy, w, d, rot)) {
      if (debug) console.log(`[placement] WOULD BLOCK FRONT of ${pe.name} at (${cx.toFixed(0)},${cy.toFixed(0)})`);
      return false;
    }
  }

  // ── RULE 4: Face-to-face minimum distance ──
  if (!checkFaceToFace(cx, cy, w, d, rot, existingPlacements)) {
    if (debug) console.log(`[placement] FACE-TO-FACE too close at (${cx.toFixed(0)},${cy.toFixed(0)})`);
    return false;
  }

  return true;
}

/** Wall segment with properties */
type WallSegment = {
  start: Point;
  end: Point;
  length: number;
  angle: number;
  normalX: number;
  normalY: number;
  edgeIndex: number;
  hasDoor: boolean;
};

/** Compute polygon winding */
function polygonSignedArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

function getRoomWalls(room: Room, doors: Door[]): WallSegment[] {
  const walls: WallSegment[] = [];
  const pts = room.points;
  const signedArea = polygonSignedArea(pts);
  const normalSign = signedArea > 0 ? 1 : -1;

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy * normalSign;
    const ny = ux * normalSign;
    const hasDoor = doors.some(d => d.roomId === room.id && d.edgeIndex === i);
    walls.push({ start: pts[i], end: pts[j], length, angle: Math.atan2(dy, dx) * 180 / Math.PI, normalX: nx, normalY: ny, edgeIndex: i, hasDoor });
  }
  return walls;
}

/** Generate wall positions */
function generateWallPositions(
  wall: WallSegment,
  equipWidth: number,
  equipDepth: number,
  step: number = 20,
): { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] {
  const positions: { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] = [];
  const rotation = ((Math.atan2(-wall.normalX, wall.normalY) * 180 / Math.PI) + 360) % 360;
  const distFromWall = equipDepth / 2 + WALL_MARGIN;
  const margin = equipWidth / 2 + 5;
  if (wall.length - margin * 2 < 0) return positions;

  for (let t = margin; t <= wall.length - margin; t += step) {
    const ratio = t / wall.length;
    const wx = wall.start.x + (wall.end.x - wall.start.x) * ratio;
    const wy = wall.start.y + (wall.end.y - wall.start.y) * ratio;
    const x = wx + wall.normalX * distFromWall;
    const y = wy + wall.normalY * distFromWall;
    const distFromEdges = Math.min(t, wall.length - t);
    const cornerPenalty = distFromEdges < 100 ? 10 : 0;
    const doorPenalty = wall.hasDoor ? 50 : 0;
    positions.push({ x, y, rotation, score: cornerPenalty + doorPenalty, wall });
  }
  return positions;
}

/** Generate positions with equipment back against a pillar face */
function generatePillarBackedPositions(
  pillars: Pillar[],
  equipWidth: number,
  equipDepth: number,
  step: number = 20,
): { x: number; y: number; rotation: number; score: number }[] {
  const positions: { x: number; y: number; rotation: number; score: number }[] = [];

  for (const pillar of pillars) {
    const px = pillar.position.x;
    const py = pillar.position.y;
    const pw = pillar.width;
    const pd = pillar.depth;
    const pRot = (pillar.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(pRot);
    const sin = Math.sin(pRot);

    const faces = [
      { nx: 0, ny: -1, faceLen: pw, rot: 0 },
      { nx: 0, ny: 1, faceLen: pw, rot: 180 },
      { nx: -1, ny: 0, faceLen: pd, rot: 90 },
      { nx: 1, ny: 0, faceLen: pd, rot: 270 },
    ];

    for (const face of faces) {
      if (face.faceLen < equipWidth * 0.5) continue;
      const distToFace = (face.nx !== 0 ? pw / 2 : pd / 2) + equipDepth / 2 + WALL_MARGIN;
      const dirX = face.nx * cos - face.ny * sin;
      const dirY = face.nx * sin + face.ny * cos;
      const cx = px + dirX * distToFace;
      const cy = py + dirY * distToFace;
      const equipRot = (face.rot + (pillar.rotation || 0) + 360) % 360;
      positions.push({ x: cx, y: cy, rotation: equipRot, score: 200 });

      if (face.faceLen > equipWidth + step) {
        const along = { x: -face.ny * cos - (-face.nx) * sin, y: -face.ny * sin + (-face.nx) * cos };
        const maxOffset = (face.faceLen - equipWidth) / 2;
        for (let t = step; t <= maxOffset; t += step) {
          positions.push({ x: cx + along.x * t, y: cy + along.y * t, rotation: equipRot, score: 200 });
          positions.push({ x: cx - along.x * t, y: cy - along.y * t, rotation: equipRot, score: 200 });
        }
      }
    }
  }

  return positions;
}

/** Generate center island positions */
function generateIslandPositions(
  room: Room,
  equipWidth: number,
  equipDepth: number,
  step: number = 20,
): { x: number; y: number; rotation: number; score: number }[] {
  const positions: { x: number; y: number; rotation: number; score: number }[] = [];
  const pts = room.points;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const roomWidth = maxX - minX;
  const roomHeight = maxY - minY;
  const isWide = roomWidth >= roomHeight;

  const backToBackGap = 10;

  if (isWide) {
    const centerY = (minY + maxY) / 2;
    const row1Y = centerY - backToBackGap / 2 - equipDepth / 2;
    const row2Y = centerY + backToBackGap / 2 + equipDepth / 2;
    if (row1Y - equipDepth / 2 - CORRIDOR_FRONT_GAP - CORRIDOR_WIDTH / 2 < minY + WALL_MARGIN) return positions;
    if (row2Y + equipDepth / 2 + CORRIDOR_FRONT_GAP + CORRIDOR_WIDTH / 2 > maxY - WALL_MARGIN) return positions;
    const margin = equipWidth / 2 + WALL_MARGIN + CORRIDOR_WIDTH;
    for (let x = minX + margin; x <= maxX - margin; x += step) {
      positions.push({ x, y: row1Y, rotation: 180, score: 100 });
      positions.push({ x, y: row2Y, rotation: 0, score: 100 });
    }
  } else {
    const centerX = (minX + maxX) / 2;
    const row1X = centerX - backToBackGap / 2 - equipDepth / 2;
    const row2X = centerX + backToBackGap / 2 + equipDepth / 2;
    if (row1X - equipDepth / 2 - CORRIDOR_FRONT_GAP - CORRIDOR_WIDTH / 2 < minX + WALL_MARGIN) return positions;
    if (row2X + equipDepth / 2 + CORRIDOR_FRONT_GAP + CORRIDOR_WIDTH / 2 > maxX - WALL_MARGIN) return positions;
    const margin = equipWidth / 2 + WALL_MARGIN + CORRIDOR_WIDTH;
    for (let y = minY + margin; y <= maxY - margin; y += step) {
      positions.push({ x: row1X, y, rotation: 270, score: 100 });
      positions.push({ x: row2X, y, rotation: 90, score: 100 });
    }
  }
  return positions;
}

/** Circulation path segment */
export type CirculationSegment = {
  start: Point;
  end: Point;
  width: number;
};

/** Result of auto-placement */
export type PlacementResult = {
  placed: PlacedEquipment[];
  notPlaced: GameEquipment[];
  circulation: CirculationSegment[];
};

/** Auto-place selected equipment in a room with business rules */
export function autoPlaceEquipment(
  selectedEquipments: GameEquipment[],
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacedEquipment[] {
  return autoPlaceEquipmentWithReport(selectedEquipments, rooms, doors, pillars, existingPlacements).placed;
}

/** Auto-place with full report */
export function autoPlaceEquipmentWithReport(
  selectedEquipments: GameEquipment[],
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacementResult {
  if (rooms.length === 0 || selectedEquipments.length === 0) {
    return { placed: [], notPlaced: selectedEquipments, circulation: [] };
  }

  // Find the largest closed room
  let bestRoom: Room | null = null;
  let bestArea = 0;
  for (const room of rooms) {
    if (!room.isClosed) continue;
    let area = 0;
    const pts = room.points;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    area = Math.abs(area) / 2;
    if (area > bestArea) { bestArea = area; bestRoom = room; }
  }

  if (!bestRoom) {
    return { placed: [], notPlaced: selectedEquipments, circulation: [] };
  }

  const doorZones = getDoorExclusionZones(rooms, doors);
  const pillarZones = getPillarExclusionZones(pillars);
  const walls = getRoomWalls(bestRoom, doors);

  const pts = bestRoom.points;
  const rMinX = Math.min(...pts.map(p => p.x)), rMaxX = Math.max(...pts.map(p => p.x));
  const rMinY = Math.min(...pts.map(p => p.y)), rMaxY = Math.max(...pts.map(p => p.y));
  console.log(`[placement] Room bounds: x[${rMinX},${rMaxX}] y[${rMinY},${rMaxY}], ${walls.length} walls, signedArea=${polygonSignedArea(pts).toFixed(0)}`);

  const placements: PlacedEquipment[] = [...existingPlacements];
  const result: PlacedEquipment[] = [];
  const notPlaced: GameEquipment[] = [];

  // ── Group by category, then by equipment ID ──
  const byEquipmentId = new Map<string, { equip: GameEquipment; count: number }>();
  for (const equip of selectedEquipments) {
    const existing = byEquipmentId.get(equip.id);
    if (existing) existing.count++;
    else byEquipmentId.set(equip.id, { equip, count: 1 });
  }

  const byCategory = new Map<string, { equip: GameEquipment; count: number }[]>();
  for (const group of byEquipmentId.values()) {
    const cat = group.equip.category || "autre";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(group);
  }

  // Sort categories by total area (largest first)
  const sortedCategories = Array.from(byCategory.entries())
    .sort((a, b) => {
      const areaA = a[1].reduce((sum, g) => sum + g.equip.width * g.equip.depth * g.count, 0);
      const areaB = b[1].reduce((sum, g) => sum + g.equip.width * g.equip.depth * g.count, 0);
      return areaB - areaA;
    });

  // ── RULE 3: Sort walls by length (longest first) for each category ──
  const nonDoorWalls = walls.filter(w => !w.hasDoor);
  const doorWalls = walls.filter(w => w.hasDoor);
  // Sort all walls by length descending so longest walls are preferred
  const wallsByLength = [...nonDoorWalls, ...doorWalls].sort((a, b) => b.length - a.length);

  // Assign walls to categories: each category gets the longest available wall(s)
  // that can fit its total equipment width
  const categoryWallMap = new Map<string, WallSegment[]>();
  const assignedWallIndices = new Set<number>();

  for (const [cat, groups] of sortedCategories) {
    // Calculate total width needed for this category (all units side by side)
    const totalUnits = groups.reduce((sum, g) => sum + g.count, 0);
    const maxWidth = Math.max(...groups.map(g => g.equip.width));
    const totalWidthNeeded = totalUnits * (maxWidth + SAME_REF_GAP);

    const catWalls: WallSegment[] = [];
    
    // RULE 3: Find the longest wall that can fit all units of this category
    for (const wall of wallsByLength) {
      if (assignedWallIndices.has(wall.edgeIndex)) continue;
      if (wall.length >= totalWidthNeeded) {
        catWalls.push(wall);
        assignedWallIndices.add(wall.edgeIndex);
        break;
      }
    }

    // If no single wall fits all, take multiple walls
    if (catWalls.length === 0) {
      let remainingWidth = totalWidthNeeded;
      for (const wall of wallsByLength) {
        if (assignedWallIndices.has(wall.edgeIndex)) continue;
        catWalls.push(wall);
        assignedWallIndices.add(wall.edgeIndex);
        remainingWidth -= wall.length;
        if (remainingWidth <= 0) break;
      }
    }

    // Fallback: if nothing assigned, use all walls
    if (catWalls.length === 0) {
      categoryWallMap.set(cat, wallsByLength);
    } else {
      categoryWallMap.set(cat, catWalls);
    }
  }

  const step = 20;

  for (const [category, equipmentGroups] of sortedCategories) {
    const sortedGroups = [...equipmentGroups].sort((a, b) =>
      (b.equip.width * b.equip.depth * b.count) - (a.equip.width * a.equip.depth * a.count)
    );

    const preferredWalls = categoryWallMap.get(category) || walls;
    let categoryLastPlacement: { x: number; y: number; rotation: number; w: number; d: number } | null = null;

    for (const group of sortedGroups) {
      const equip = group.equip;
      const count = group.count;
      let lastPlacement: { x: number; y: number; rotation: number; w: number; d: number } | null = categoryLastPlacement;

      for (let i = 0; i < count; i++) {
        let placed = false;
        const isSameRef = lastPlacement !== null;
        const gap = isSameRef ? SAME_REF_GAP : DIFFERENT_GAP;

        // Check existing placements for same equipmentId
        if (!lastPlacement) {
          const existingSameRef = placements.find(p => p.equipmentId === equip.id);
          if (existingSameRef) {
            lastPlacement = {
              x: existingSameRef.position.x,
              y: existingSameRef.position.y,
              rotation: existingSameRef.rotation,
              w: existingSameRef.width,
              d: existingSameRef.depth,
            };
          }
        }

        // ── RULE 1: Adjacent placement must use SAME rotation (same orientation) ──
        if (lastPlacement) {
          const curW = equip.width;
          const curD = equip.depth;
          // Only try the SAME rotation as last placement (Rule 1: same orientation)
          const adjPositions = generateAdjacentPositions(
            lastPlacement.x, lastPlacement.y, lastPlacement.rotation,
            lastPlacement.w, lastPlacement.d,
            curW, curD, SAME_REF_GAP
          );
          for (const pos of adjPositions) {
            if (isPlacementValid(pos.x, pos.y, curW, curD, pos.rotation, SAME_REF_GAP, bestRoom, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, curW, curD);
              placements.push(p);
              result.push(p);
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: curW, d: curD };
              placed = true;
              break;
            }
          }
        }

        if (placed) continue;

        // ── Wall positions (preferred walls first = longest walls, then all) ──
        for (const wallSet of [preferredWalls, walls]) {
          if (placed) break;
          // Only try natural wall orientation (no 90° flip) — Rule 1: consistent orientation
          const w = equip.width;
          const d = equip.depth;

          const allWallPos: { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] = [];
          for (const wall of wallSet) {
            if (wall.hasDoor && w > 100) continue;
            const positions = generateWallPositions(wall, w, d, step);
            allWallPos.push(...positions);
          }
          allWallPos.sort((a, b) => a.score - b.score);

          for (const pos of allWallPos) {
            if (isPlacementValid(pos.x, pos.y, w, d, pos.rotation, gap, bestRoom, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, w, d);
              placements.push(p);
              result.push(p);
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w, d };
              placed = true;
              break;
            }
          }
        }

        // ── Fallback: pillar-backed positions ──
        if (!placed) {
          const w = equip.width;
          const d = equip.depth;
          const pillarPositions = generatePillarBackedPositions(pillars, w, d, step);

          for (const pos of pillarPositions) {
            if (isPlacementValid(pos.x, pos.y, w, d, pos.rotation, gap, bestRoom!, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, w, d);
              placements.push(p);
              result.push(p);
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w, d };
              placed = true;
              break;
            }
          }
        }

        if (!placed) {
          console.warn(`Could not place: ${equip.name} (instance ${i + 1}/${count})`);
          notPlaced.push(equip);
        }
      }
      if (lastPlacement) categoryLastPlacement = lastPlacement;
    }
  }

  const circulation = generateCirculationPath(bestRoom, result, CORRIDOR_WIDTH);
  return { placed: result, notPlaced, circulation };
}

/** Helper to create a PlacedEquipment */
function makePlacement(equip: GameEquipment, x: number, y: number, rotation: number, w: number, d: number): PlacedEquipment {
  return {
    id: crypto.randomUUID(),
    equipmentId: equip.id,
    position: { x, y },
    rotation,
    name: equip.name,
    width: w,
    depth: d,
    safetyZone: equip.safetyZone,
    color: equip.color || "hsl(263, 85%, 68%)",
  };
}

/** Generate positions adjacent to a previous placement (RULE 1: same rotation) */
function generateAdjacentPositions(
  prevX: number, prevY: number, prevRot: number,
  prevW: number, prevD: number,
  curW: number, curD: number, gap: number,
): { x: number; y: number; rotation: number }[] {
  const positions: { x: number; y: number; rotation: number }[] = [];
  const rotation = prevRot; // Rule 1: enforce same orientation
  const rad = prevRot * Math.PI / 180;
  const wallDirX = Math.cos(rad);
  const wallDirY = Math.sin(rad);
  const baseSpacing = prevW / 2 + curW / 2 + gap + 1;

  for (const mult of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
    const sign = mult > 0 ? 1 : -1;
    const index = Math.abs(mult);
    const dist = baseSpacing + (index - 1) * (curW + gap);
    positions.push({
      x: prevX + wallDirX * dist * sign,
      y: prevY + wallDirY * dist * sign,
      rotation,
    });
  }
  return positions;
}

/** Generate circulation path for the room */
function generateCirculationPath(
  room: Room,
  placedEquipments: PlacedEquipment[],
  corridorWidth: number,
): CirculationSegment[] {
  const segments: CirculationSegment[] = [];
  const pts = room.points;
  if (pts.length < 3 || placedEquipments.length === 0) return segments;

  const roomMinX = Math.min(...pts.map(p => p.x));
  const roomMaxX = Math.max(...pts.map(p => p.x));
  const roomMinY = Math.min(...pts.map(p => p.y));
  const roomMaxY = Math.max(...pts.map(p => p.y));
  const roomWidth = roomMaxX - roomMinX;
  const roomHeight = roomMaxY - roomMinY;
  const isWide = roomWidth >= roomHeight;

  if (isWide) {
    const corridorY = (roomMinY + roomMaxY) / 2;
    segments.push({
      start: { x: roomMinX + corridorWidth, y: corridorY },
      end: { x: roomMaxX - corridorWidth, y: corridorY },
      width: corridorWidth,
    });
  } else {
    const corridorX = (roomMinX + roomMaxX) / 2;
    segments.push({
      start: { x: corridorX, y: roomMinY + corridorWidth },
      end: { x: corridorX, y: roomMaxY - corridorWidth },
      width: corridorWidth,
    });
  }

  return segments;
}

/** Distance from a point to a line segment */
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}
