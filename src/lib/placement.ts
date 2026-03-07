import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { DOOR_EXCLUSION_DEPTH, PMR_CLEARANCE } from "@/types/equipment";
import { CM_TO_PX } from "@/types/editor";

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

/** Check if two rotated rectangles overlap (SAT - Separating Axis Theorem) */
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
    const nx = -uy, ny = ux; // interior normal

    const centerDist = door.positionRatio * wallLen;
    const doorCx = a.x + ux * centerDist;
    const doorCy = a.y + uy * centerDist;

    // Exclusion zone: rectangle centered on door, extending DOOR_EXCLUSION_DEPTH on both sides
    const zoneCx = doorCx + nx * (DOOR_EXCLUSION_DEPTH / 2 - DOOR_EXCLUSION_DEPTH / 2); // centered on wall
    const zoneCy = doorCy + ny * (DOOR_EXCLUSION_DEPTH / 2 - DOOR_EXCLUSION_DEPTH / 2);
    const rot = Math.atan2(dy, dx) * 180 / Math.PI;

    // Two zones: interior and exterior
    const interiorCx = doorCx + nx * DOOR_EXCLUSION_DEPTH / 2;
    const interiorCy = doorCy + ny * DOOR_EXCLUSION_DEPTH / 2;
    zones.push({ cx: interiorCx, cy: interiorCy, w: door.width + 40, d: DOOR_EXCLUSION_DEPTH, rot });

    const exteriorCx = doorCx - nx * DOOR_EXCLUSION_DEPTH / 2;
    const exteriorCy = doorCy - ny * DOOR_EXCLUSION_DEPTH / 2;
    zones.push({ cx: exteriorCx, cy: exteriorCy, w: door.width + 40, d: DOOR_EXCLUSION_DEPTH, rot });
  }
  return zones;
}

/** Get pillar exclusion zones (pillar bounding box + small margin) */
function getPillarExclusionZones(pillars: Pillar[]): { cx: number; cy: number; r: number; w: number; d: number; rot: number; shape: string }[] {
  return pillars.map(p => ({
    cx: p.position.x,
    cy: p.position.y,
    r: p.shape === "round" ? p.width / 2 + 10 : 0,
    w: p.width + 20,
    d: p.depth + 20,
    rot: p.rotation || 0,
    shape: p.shape,
  }));
}

/** Check if an equipment placement is valid */
function isPlacementValid(
  cx: number, cy: number, w: number, d: number, rot: number, safetyZone: number,
  room: Room,
  doorZones: { cx: number; cy: number; w: number; d: number; rot: number }[],
  pillarZones: ReturnType<typeof getPillarExclusionZones>,
  existingPlacements: PlacedEquipment[],
): boolean {
  // 1. Equipment + safety zone must be inside room
  const totalW = w + safetyZone * 2;
  const totalD = d + safetyZone * 2;
  if (!rectInsidePolygon(cx, cy, totalW, totalD, rot, room.points)) return false;

  // 2. Must not overlap door exclusion zones
  for (const dz of doorZones) {
    if (rectsOverlap(cx, cy, w, d, rot, dz.cx, dz.cy, dz.w, dz.d, dz.rot)) return false;
  }

  // 3. Must not overlap pillars
  for (const pz of pillarZones) {
    if (rectsOverlap(cx, cy, w + 20, d + 20, rot, pz.cx, pz.cy, pz.w, pz.d, pz.rot)) return false;
  }

  // 4. Must not overlap other placed equipment (including their safety zones)
  for (const pe of existingPlacements) {
    const overlapW = w / 2 + pe.width / 2 + Math.max(safetyZone, pe.safetyZone);
    const overlapD = d / 2 + pe.depth / 2 + Math.max(safetyZone, pe.safetyZone);
    if (rectsOverlap(cx, cy, w + safetyZone, d + safetyZone, rot, pe.position.x, pe.position.y, pe.width + pe.safetyZone, pe.depth + pe.safetyZone, pe.rotation)) {
      return false;
    }
  }

  return true;
}

/** Auto-place selected equipment in a room */
export function autoPlaceEquipment(
  selectedEquipments: GameEquipment[],
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacedEquipment[] {
  if (rooms.length === 0 || selectedEquipments.length === 0) return [];

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
    if (area > bestArea) {
      bestArea = area;
      bestRoom = room;
    }
  }

  if (!bestRoom) return [];

  const doorZones = getDoorExclusionZones(rooms, doors);
  const pillarZones = getPillarExclusionZones(pillars);

  // Compute bounding box of the room
  const pts = bestRoom.points;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));

  const placements: PlacedEquipment[] = [...existingPlacements];
  const result: PlacedEquipment[] = [];

  // Sort equipment by area (largest first for better packing)
  const sorted = [...selectedEquipments].sort((a, b) => (b.width * b.depth) - (a.width * a.depth));

  const step = 20; // 20cm grid step for placement search

  for (const equip of sorted) {
    let placed = false;

    // Try both orientations (0° and 90°)
    for (const rot of [0, 90]) {
      if (placed) break;
      const w = rot === 0 ? equip.width : equip.depth;
      const d = rot === 0 ? equip.depth : equip.width;
      const sz = equip.safetyZone;

      // Scan from top-left corner with safety margin
      for (let y = minY + sz + d / 2; y <= maxY - sz - d / 2; y += step) {
        if (placed) break;
        for (let x = minX + sz + w / 2; x <= maxX - sz - w / 2; x += step) {
          if (isPlacementValid(x, y, w, d, rot, sz, bestRoom, doorZones, pillarZones, placements)) {
            const placement: PlacedEquipment = {
              id: crypto.randomUUID(),
              equipmentId: equip.id,
              position: { x, y },
              rotation: rot,
              name: equip.name,
              width: w,
              depth: d,
              safetyZone: sz,
              color: equip.color || "hsl(263, 85%, 68%)",
            };
            placements.push(placement);
            result.push(placement);
            placed = true;
            break;
          }
        }
      }
    }

    if (!placed) {
      console.warn(`Could not place: ${equip.name}`);
    }
  }

  return result;
}
