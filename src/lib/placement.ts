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
    // Interior zone
    zones.push({ cx: doorCx + nx * DOOR_EXCLUSION_DEPTH / 2, cy: doorCy + ny * DOOR_EXCLUSION_DEPTH / 2, w: door.width + 40, d: DOOR_EXCLUSION_DEPTH, rot });
    // Exterior zone
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

/** Check if an equipment placement is valid (no overlap with walls, doors, pillars, other equipment) */
function isPlacementValid(
  cx: number, cy: number, w: number, d: number, rot: number, gap: number,
  room: Room,
  doorZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  pillarZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  existingPlacements: PlacedEquipment[],
): boolean {
  // Must be inside room with wall margin
  if (!rectInsidePolygon(cx, cy, w + WALL_MARGIN * 2, d + WALL_MARGIN * 2, rot, room.points)) return false;
  // Must not overlap door exclusion zones
  for (const dz of doorZones) {
    if (rectsOverlap(cx, cy, w, d, rot, dz.cx, dz.cy, dz.w, dz.d, dz.rot)) return false;
  }
  // Must not overlap pillars
  for (const pz of pillarZones) {
    if (rectsOverlap(cx, cy, w + 20, d + 20, rot, pz.cx, pz.cy, pz.w, pz.d, pz.rot)) return false;
  }
  // Must not overlap other equipment (with gap)
  for (const pe of existingPlacements) {
    if (rectsOverlap(cx, cy, w + gap, d + gap, rot, pe.position.x, pe.position.y, pe.width + gap, pe.depth + gap, pe.rotation)) {
      return false;
    }
  }
  return true;
}

/** Wall segment with properties */
type WallSegment = {
  start: Point;
  end: Point;
  length: number;
  angle: number; // degrees
  normalX: number; // interior normal
  normalY: number;
  edgeIndex: number;
  hasDoor: boolean;
};

/** Compute polygon winding: positive = CCW, negative = CW */
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
  // Determine winding: if signed area > 0, polygon is CCW → flip normals
  const signedArea = polygonSignedArea(pts);
  const normalSign = signedArea > 0 ? -1 : 1; // flip for CCW so normals point inward

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;
    // Normal perpendicular to wall, guaranteed to point inward
    const nx = -uy * normalSign;
    const ny = ux * normalSign;
    const hasDoor = doors.some(d => d.roomId === room.id && d.edgeIndex === i);
    walls.push({ start: pts[i], end: pts[j], length, angle: Math.atan2(dy, dx) * 180 / Math.PI, normalX: nx, normalY: ny, edgeIndex: i, hasDoor });
  }
  return walls;
}

/** Generate wall positions (back against wall, facing inward) */
function generateWallPositions(
  wall: WallSegment,
  equipWidth: number,
  equipDepth: number,
  step: number = 20,
): { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] {
  const positions: { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] = [];
  // Equipment back against the wall, facing inward
  const rotation = (wall.angle + 90 + 360) % 360;
  // Distance from wall surface to equipment center
  const distFromWall = equipDepth / 2 + WALL_MARGIN;
  const margin = equipWidth / 2 + 5; // small margin from wall corners
  if (wall.length - margin * 2 < 0) return positions;

  for (let t = margin; t <= wall.length - margin; t += step) {
    const ratio = t / wall.length;
    const wx = wall.start.x + (wall.end.x - wall.start.x) * ratio;
    const wy = wall.start.y + (wall.end.y - wall.start.y) * ratio;
    const x = wx + wall.normalX * distFromWall;
    const y = wy + wall.normalY * distFromWall;
    // Prefer walls without doors, positions away from corners
    const distFromEdges = Math.min(t, wall.length - t);
    const cornerPenalty = distFromEdges < 100 ? 10 : 0;
    const doorPenalty = wall.hasDoor ? 50 : 0;
    positions.push({ x, y, rotation, score: cornerPenalty + doorPenalty, wall });
  }
  return positions;
}

/**
 * Generate positions with equipment back against a pillar face.
 * Each pillar has 4 faces (top, bottom, left, right); equipment is placed
 * with its back touching the pillar face, facing outward.
 */
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

    // 4 faces of the pillar: each defined by direction from center and equipment rotation
    const faces = [
      { nx: 0, ny: -1, faceLen: pw, rot: 0 },    // top face → equipment faces down (rot 0)
      { nx: 0, ny: 1, faceLen: pw, rot: 180 },    // bottom face → equipment faces up (rot 180)
      { nx: -1, ny: 0, faceLen: pd, rot: 90 },    // left face → equipment faces right (rot 90)
      { nx: 1, ny: 0, faceLen: pd, rot: 270 },    // right face → equipment faces left (rot 270)
    ];

    for (const face of faces) {
      // Only place if the pillar face is wide enough for the equipment
      if (face.faceLen < equipWidth * 0.5) continue;

      // Distance from pillar center to the face surface + equipment half-depth + margin
      const distToFace = (face.nx !== 0 ? pw / 2 : pd / 2) + equipDepth / 2 + WALL_MARGIN;

      // World-space direction (accounting for pillar rotation)
      const dirX = face.nx * cos - face.ny * sin;
      const dirY = face.nx * sin + face.ny * cos;

      const cx = px + dirX * distToFace;
      const cy = py + dirY * distToFace;
      const equipRot = (face.rot + (pillar.rotation || 0) + 360) % 360;

      positions.push({ x: cx, y: cy, rotation: equipRot, score: 200 }); // higher score = less preferred than walls

      // If the face is wider than the equipment, add offset positions along the face
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


/** Generate center island positions (kept for reference) */
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

  // Back-to-back gap (two equipment backs together)
  const backToBackGap = 10;
  // Minimum space needed on each side: corridor + gap + equipment depth
  const neededSide = CORRIDOR_WIDTH + CORRIDOR_FRONT_GAP + equipDepth / 2;

  if (isWide) {
    const centerY = (minY + maxY) / 2;
    // Row 1: facing up (front = top) → rotation 180
    const row1Y = centerY - backToBackGap / 2 - equipDepth / 2;
    // Row 2: facing down (front = bottom) → rotation 0
    const row2Y = centerY + backToBackGap / 2 + equipDepth / 2;

    // Check there's enough room for corridor on each side
    if (row1Y - equipDepth / 2 - CORRIDOR_FRONT_GAP - CORRIDOR_WIDTH / 2 < minY + WALL_MARGIN) return positions;
    if (row2Y + equipDepth / 2 + CORRIDOR_FRONT_GAP + CORRIDOR_WIDTH / 2 > maxY - WALL_MARGIN) return positions;

    const margin = equipWidth / 2 + WALL_MARGIN + CORRIDOR_WIDTH;
    for (let x = minX + margin; x <= maxX - margin; x += step) {
      positions.push({ x, y: row1Y, rotation: 180, score: 100 });
      positions.push({ x, y: row2Y, rotation: 0, score: 100 });
    }
  } else {
    const centerX = (minX + maxX) / 2;
    // Row 1: facing left → rotation 270
    const row1X = centerX - backToBackGap / 2 - equipDepth / 2;
    // Row 2: facing right → rotation 90
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

  const placements: PlacedEquipment[] = [...existingPlacements];
  const result: PlacedEquipment[] = [];
  const notPlaced: GameEquipment[] = [];

  // ── RULE 4: Group by category, then by equipment ID (same ref together) ──
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

  // Sort categories by total area (largest first to place biggest first)
  const sortedCategories = Array.from(byCategory.entries())
    .sort((a, b) => {
      const areaA = a[1].reduce((sum, g) => sum + g.equip.width * g.equip.depth * g.count, 0);
      const areaB = b[1].reduce((sum, g) => sum + g.equip.width * g.equip.depth * g.count, 0);
      return areaB - areaA;
    });

  // ── Assign wall sectors per category (RULE 4) ──
  // Distribute walls among categories so each category gets a contiguous sector
  const nonDoorWalls = walls.filter(w => !w.hasDoor);
  const doorWalls = walls.filter(w => w.hasDoor);
  // All walls sorted by edge index for spatial contiguity
  const sortedWalls = [...nonDoorWalls, ...doorWalls].sort((a, b) => a.edgeIndex - b.edgeIndex);

  // Assign wall ranges to categories (simple round-robin of wall groups)
  const categoryWallMap = new Map<string, WallSegment[]>();
  if (sortedCategories.length > 0 && sortedWalls.length > 0) {
    const wallsPerCat = Math.max(1, Math.floor(sortedWalls.length / sortedCategories.length));
    let wallIdx = 0;
    for (const [cat] of sortedCategories) {
      const catWalls: WallSegment[] = [];
      const end = Math.min(wallIdx + wallsPerCat, sortedWalls.length);
      for (let i = wallIdx; i < end; i++) {
        catWalls.push(sortedWalls[i]);
      }
      // Last category gets remaining walls
      if (cat === sortedCategories[sortedCategories.length - 1][0]) {
        for (let i = end; i < sortedWalls.length; i++) {
          catWalls.push(sortedWalls[i]);
        }
      }
      categoryWallMap.set(cat, catWalls);
      wallIdx = end;
    }
  }

  const step = 20;

  for (const [category, equipmentGroups] of sortedCategories) {
    // Sort equipment groups by area (largest first)
    const sortedGroups = [...equipmentGroups].sort((a, b) =>
      (b.equip.width * b.equip.depth * b.count) - (a.equip.width * a.equip.depth * a.count)
    );

    // Walls assigned to this category (preferred), fallback to all walls
    const preferredWalls = categoryWallMap.get(category) || walls;

    for (const group of sortedGroups) {
      const equip = group.equip;
      const count = group.count;
      let lastPlacement: { x: number; y: number; rotation: number; w: number; d: number } | null = null;

      for (let i = 0; i < count; i++) {
        let placed = false;
        const isSameRef = lastPlacement !== null;
        const gap = isSameRef ? SAME_REF_GAP : DIFFERENT_GAP;

        // ── RULE 3: If same ref, try adjacent to previous placement first ──
        if (lastPlacement) {
          const adjPositions = generateAdjacentPositions(
            lastPlacement.x, lastPlacement.y, lastPlacement.rotation,
            lastPlacement.w, lastPlacement.d, SAME_REF_GAP
          );
          for (const pos of adjPositions) {
            if (isPlacementValid(pos.x, pos.y, lastPlacement.w, lastPlacement.d, pos.rotation, SAME_REF_GAP, bestRoom, doorZones, pillarZones, placements)) {
              const p = makePlacement(equip, pos.x, pos.y, pos.rotation, lastPlacement.w, lastPlacement.d);
              placements.push(p);
              result.push(p);
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w: lastPlacement.w, d: lastPlacement.d };
              placed = true;
              break;
            }
          }
        }

        if (placed) continue;

        // ── RULE 1: Try wall positions (preferred walls for this category first, then all) ──
        for (const wallSet of [preferredWalls, walls]) {
          if (placed) break;
          for (const orientRot of [0, 90]) {
            if (placed) break;
            const w = orientRot === 0 ? equip.width : equip.depth;
            const d = orientRot === 0 ? equip.depth : equip.width;

            const allWallPos: { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] = [];
            for (const wall of wallSet) {
              if (wall.hasDoor && w > 100) continue;
              const positions = generateWallPositions(wall, w, d, step);
              for (const pos of positions) {
                const finalRot = (pos.rotation + orientRot) % 360;
                allWallPos.push({ ...pos, rotation: finalRot });
              }
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
        }

        // ── RULE 2b: Fallback — try placing back against a pillar ──
        if (!placed) {
          for (const orientRot of [0, 90]) {
            if (placed) break;
            const w = orientRot === 0 ? equip.width : equip.depth;
            const d = orientRot === 0 ? equip.depth : equip.width;
            const pillarPositions = generatePillarBackedPositions(pillars, w, d, step);
            const gap2 = isSameRef ? SAME_REF_GAP : DIFFERENT_GAP;

            for (const pos of pillarPositions) {
              if (isPlacementValid(pos.x, pos.y, w, d, pos.rotation, gap2, bestRoom!, doorZones, pillarZones, placements)) {
                const p = makePlacement(equip, pos.x, pos.y, pos.rotation, w, d);
                placements.push(p);
                result.push(p);
                lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, w, d };
                placed = true;
                break;
              }
            }
          }
        }

        if (!placed) {
          console.warn(`Could not place: ${equip.name} (instance ${i + 1}/${count})`);
          notPlaced.push(equip);
        }
      }
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

/** Generate positions adjacent to a previous placement (side by side, 5cm gap for same ref) */
function generateAdjacentPositions(
  prevX: number, prevY: number, prevRot: number,
  w: number, d: number, gap: number,
): { x: number; y: number; rotation: number }[] {
  const positions: { x: number; y: number; rotation: number }[] = [];
  const rotation = prevRot;
  const rad = prevRot * Math.PI / 180;
  // Along-wall direction (perpendicular to facing)
  const wallDirX = -Math.sin(rad);
  const wallDirY = Math.cos(rad);
  const spacing = w + gap;

  for (const mult of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
    positions.push({
      x: prevX + wallDirX * spacing * mult,
      y: prevY + wallDirY * spacing * mult,
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
