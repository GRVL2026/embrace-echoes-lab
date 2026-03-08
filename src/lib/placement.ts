import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { DOOR_EXCLUSION_DEPTH, PMR_CLEARANCE } from "@/types/equipment";

// Corridor width for accessibility
const CORRIDOR_WIDTH = 140; // 1.4m

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
    const nx = -uy, ny = ux;

    const centerDist = door.positionRatio * wallLen;
    const doorCx = a.x + ux * centerDist;
    const doorCy = a.y + uy * centerDist;
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

/** Get pillar exclusion zones */
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
    if (rectsOverlap(cx, cy, w + safetyZone, d + safetyZone, rot, pe.position.x, pe.position.y, pe.width + pe.safetyZone, pe.depth + pe.safetyZone, pe.rotation)) {
      return false;
    }
  }

  return true;
}

/** Get all wall segments of a room with their properties */
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

function getRoomWalls(room: Room, doors: Door[]): WallSegment[] {
  const walls: WallSegment[] = [];
  const pts = room.points;
  
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    
    const ux = dx / length;
    const uy = dy / length;
    // Interior normal (perpendicular, pointing inward for clockwise polygon)
    const nx = -uy;
    const ny = ux;
    
    const hasDoor = doors.some(d => d.roomId === room.id && d.edgeIndex === i);
    
    walls.push({
      start: pts[i],
      end: pts[j],
      length,
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
      normalX: nx,
      normalY: ny,
      edgeIndex: i,
      hasDoor,
    });
  }
  
  return walls;
}

/** Generate wall positions along a wall segment */
function generateWallPositions(
  wall: WallSegment,
  equipWidth: number,
  equipDepth: number,
  safetyZone: number,
  step: number = 20,
): { x: number; y: number; rotation: number; score: number }[] {
  const positions: { x: number; y: number; rotation: number; score: number }[] = [];
  
  // Equipment should be placed parallel to the wall, back against the wall
  // Rotation = wall angle + 90° to face inward
  const rotation = (wall.angle + 90 + 360) % 360;
  
  // Distance from wall center to equipment center
  const distFromWall = equipDepth / 2 + 5; // 5cm margin from wall
  
  // Offset along the wall
  const margin = equipWidth / 2 + safetyZone;
  const usableLength = wall.length - margin * 2;
  
  if (usableLength < 0) return positions;
  
  for (let t = margin; t <= wall.length - margin; t += step) {
    // Position along the wall
    const wx = wall.start.x + (wall.end.x - wall.start.x) * (t / wall.length);
    const wy = wall.start.y + (wall.end.y - wall.start.y) * (t / wall.length);
    
    // Move into the room by the equipment depth/2
    const x = wx + wall.normalX * distFromWall;
    const y = wy + wall.normalY * distFromWall;
    
    // Score: prefer walls without doors, and positions away from corners
    const distFromEdges = Math.min(t, wall.length - t);
    const cornerPenalty = distFromEdges < 100 ? 10 : 0;
    const doorPenalty = wall.hasDoor ? 50 : 0;
    const score = cornerPenalty + doorPenalty;
    
    positions.push({ x, y, rotation, score });
  }
  
  return positions;
}

/** Generate center island positions (back-to-back rows) */
function generateIslandPositions(
  room: Room,
  equipWidth: number,
  equipDepth: number,
  safetyZone: number,
  existingPlacements: PlacedEquipment[],
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
  
  // Determine primary axis (longer dimension)
  const isWide = roomWidth >= roomHeight;
  
  // Calculate corridor positions
  const wallMargin = Math.max(equipDepth, equipWidth) + safetyZone + CORRIDOR_WIDTH;
  
  // Create back-to-back islands in the center
  // Two rows facing opposite directions with minimal gap between backs
  const backToBackGap = 20; // 20cm between backs
  
  if (isWide) {
    // Horizontal room: create vertical aisles with horizontal rows
    const centerY = (minY + maxY) / 2;
    
    // Row 1: facing up (rotation 180)
    const row1Y = centerY - backToBackGap / 2 - equipDepth / 2;
    // Row 2: facing down (rotation 0)
    const row2Y = centerY + backToBackGap / 2 + equipDepth / 2;
    
    for (let x = minX + wallMargin; x <= maxX - wallMargin; x += step) {
      positions.push({ x, y: row1Y, rotation: 180, score: 100 }); // Higher score = lower priority
      positions.push({ x, y: row2Y, rotation: 0, score: 100 });
    }
  } else {
    // Vertical room: create horizontal aisles with vertical rows
    const centerX = (minX + maxX) / 2;
    
    // Row 1: facing left (rotation 270)
    const row1X = centerX - backToBackGap / 2 - equipDepth / 2;
    // Row 2: facing right (rotation 90)
    const row2X = centerX + backToBackGap / 2 + equipDepth / 2;
    
    for (let y = minY + wallMargin; y <= maxY - wallMargin; y += step) {
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
  width: number; // corridor width in cm
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
  const result = autoPlaceEquipmentWithReport(selectedEquipments, rooms, doors, pillars, existingPlacements);
  return result.placed;
}

/** Auto-place with full report (placed + not placed) */
export function autoPlaceEquipmentWithReport(
  selectedEquipments: GameEquipment[],
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  existingPlacements: PlacedEquipment[],
): PlacementResult {
  if (rooms.length === 0 || selectedEquipments.length === 0) {
    return { placed: [], notPlaced: selectedEquipments };
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
    if (area > bestArea) {
      bestArea = area;
      bestRoom = room;
    }
  }

  if (!bestRoom) {
    return { placed: [], notPlaced: selectedEquipments };
  }

  const doorZones = getDoorExclusionZones(rooms, doors);
  const pillarZones = getPillarExclusionZones(pillars);
  const walls = getRoomWalls(bestRoom, doors);

  const placements: PlacedEquipment[] = [...existingPlacements];
  const result: PlacedEquipment[] = [];
  const notPlaced: GameEquipment[] = [];

  // Group equipment by ID first (to keep duplicates together), then by category
  const byEquipmentId = new Map<string, { equip: GameEquipment; count: number }>();
  for (const equip of selectedEquipments) {
    const existing = byEquipmentId.get(equip.id);
    if (existing) {
      existing.count++;
    } else {
      byEquipmentId.set(equip.id, { equip, count: 1 });
    }
  }

  // Group by category, keeping equipment groups intact
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

  // Track which wall segments are "full"
  const wallOccupancy = new Map<number, number>(); // edgeIndex -> occupied length
  walls.forEach(w => wallOccupancy.set(w.edgeIndex, 0));

  const step = 25; // 25cm grid step

  for (const [category, equipmentGroups] of sortedCategories) {
    // Sort equipment groups by total area (largest first)
    const sortedGroups = [...equipmentGroups].sort((a, b) => 
      (b.equip.width * b.equip.depth * b.count) - (a.equip.width * a.equip.depth * a.count)
    );

    for (const group of sortedGroups) {
      const equip = group.equip;
      const count = group.count;
      const sz = equip.safetyZone;
      
      // Track last placement for this equipment type to place duplicates adjacent
      let lastPlacement: { x: number; y: number; rotation: number; wall?: WallSegment } | null = null;

      for (let i = 0; i < count; i++) {
        let placed = false;

        // Try each orientation
        for (const orientationRot of [0, 90]) {
          if (placed) break;
          
          const w = orientationRot === 0 ? equip.width : equip.depth;
          const d = orientationRot === 0 ? equip.depth : equip.width;

          // If we have a previous placement of the same equipment, try adjacent positions first
          if (lastPlacement) {
            const adjacentPositions = generateAdjacentPositions(
              lastPlacement.x, lastPlacement.y, lastPlacement.rotation,
              w, d, sz, step
            );
            
            for (const pos of adjacentPositions) {
              if (isPlacementValid(pos.x, pos.y, w, d, pos.rotation, sz, bestRoom, doorZones, pillarZones, placements)) {
                const placement: PlacedEquipment = {
                  id: crypto.randomUUID(),
                  equipmentId: equip.id,
                  position: { x: pos.x, y: pos.y },
                  rotation: pos.rotation,
                  name: equip.name,
                  width: w,
                  depth: d,
                  safetyZone: sz,
                  color: equip.color || "hsl(263, 85%, 68%)",
                };
                placements.push(placement);
                result.push(placement);
                lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation };
                placed = true;
                break;
              }
            }
            if (placed) break;
          }

          // PHASE 1: Try wall positions first
          const allWallPositions: { x: number; y: number; rotation: number; score: number; wall: WallSegment }[] = [];
          
          for (const wall of walls) {
            // Skip walls with doors for larger equipment
            if (wall.hasDoor && w > 100) continue;
            
            const positions = generateWallPositions(wall, w, d, sz, step);
            for (const pos of positions) {
              // Adjust rotation based on equipment orientation
              const finalRot = (pos.rotation + orientationRot) % 360;
              allWallPositions.push({ ...pos, rotation: finalRot, wall });
            }
          }

          // Sort by score (lower is better)
          allWallPositions.sort((a, b) => a.score - b.score);

          for (const pos of allWallPositions) {
            if (isPlacementValid(pos.x, pos.y, w, d, pos.rotation, sz, bestRoom, doorZones, pillarZones, placements)) {
              const placement: PlacedEquipment = {
                id: crypto.randomUUID(),
                equipmentId: equip.id,
                position: { x: pos.x, y: pos.y },
                rotation: pos.rotation,
                name: equip.name,
                width: w,
                depth: d,
                safetyZone: sz,
                color: equip.color || "hsl(263, 85%, 68%)",
              };
              placements.push(placement);
              result.push(placement);
              lastPlacement = { x: pos.x, y: pos.y, rotation: pos.rotation, wall: pos.wall };
              placed = true;
              
              // Update wall occupancy
              const occ = wallOccupancy.get(pos.wall.edgeIndex) || 0;
              wallOccupancy.set(pos.wall.edgeIndex, occ + w + sz);
              break;
            }
          }

          // PHASE 2: If wall placement failed, try center island (back-to-back)
          if (!placed) {
            const islandPositions = generateIslandPositions(bestRoom, w, d, sz, placements, step);
            
            for (const pos of islandPositions) {
              const finalRot = (pos.rotation + orientationRot) % 360;
              if (isPlacementValid(pos.x, pos.y, w, d, finalRot, sz, bestRoom, doorZones, pillarZones, placements)) {
                const placement: PlacedEquipment = {
                  id: crypto.randomUUID(),
                  equipmentId: equip.id,
                  position: { x: pos.x, y: pos.y },
                  rotation: finalRot,
                  name: equip.name,
                  width: w,
                  depth: d,
                  safetyZone: sz,
                  color: equip.color || "hsl(263, 85%, 68%)",
                };
                placements.push(placement);
                result.push(placement);
                lastPlacement = { x: pos.x, y: pos.y, rotation: finalRot };
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

  return { placed: result, notPlaced };
}

/** Generate positions adjacent to a previous placement */
function generateAdjacentPositions(
  prevX: number, prevY: number, prevRot: number,
  w: number, d: number, sz: number,
  step: number,
): { x: number; y: number; rotation: number }[] {
  const positions: { x: number; y: number; rotation: number }[] = [];
  
  // Keep the same rotation for uniformity
  const rotation = prevRot;
  
  // Calculate offset based on rotation (place side by side)
  const rad = prevRot * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  
  // Spacing between equipment (width + small gap between safety zones)
  const spacing = w + 10; // 10cm gap
  
  // Try positions to the left and right along the equipment's orientation
  // "Left" and "Right" relative to the equipment's facing direction
  const offsets = [
    { dx: spacing, dy: 0 },   // Right
    { dx: -spacing, dy: 0 },  // Left
    { dx: spacing * 2, dy: 0 },   // Further right
    { dx: -spacing * 2, dy: 0 },  // Further left
  ];
  
  for (const offset of offsets) {
    // Rotate offset based on equipment rotation
    const rotatedDx = offset.dx * cos - offset.dy * sin;
    const rotatedDy = offset.dx * sin + offset.dy * cos;
    
    positions.push({
      x: prevX + rotatedDx,
      y: prevY + rotatedDy,
      rotation,
    });
  }
  
  return positions;
}
