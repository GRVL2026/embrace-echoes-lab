import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";
import { sampleSpline } from "@/lib/circulationSpline";

const CORRIDOR_WIDTH = 120; // 1.20m standard corridor width in cm
const HALF_CORRIDOR = CORRIDOR_WIDTH / 2; // 60cm
const TURNING_ZONE_WIDTH = 140; // 1.40m turning zone at corridor extremities for wheelchairs
const TURNING_ZONE_SEGMENTS = 8; // number of segments at each end marked as turning zone

export type CirculationSegment = {
  start: Point;
  end: Point;
  width: number;
};

export type RemovalProposal = {
  id: string;
  label: string;
  equipmentIdsToRemove: string[];
  removedNames: string[];
  resultingCirculation: CirculationSegment[];
  remainingEquipments: PlacedEquipment[];
};

export type CirculationResult = {
  segments: CirculationSegment[];
  success: boolean; // true = all equipments reachable
  unreachableCount: number; // number of equipments not reachable
  proposals: RemovalProposal[]; // suggestions if !success
};

/** Build an occupancy grid for pathfinding. true = blocked */
function buildOccupancyGrid(
  room: Room,
  equipments: PlacedEquipment[],
  pillars: Pillar[],
  doors: Door[],
  rooms: Room[],
  resolution: number,
): {
  grid: boolean[][];
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  res: number;
} {
  const pts = room.points;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));

  const margin = 10; // extra margin around room
  const ox = minX - margin;
  const oy = minY - margin;
  const cols = Math.ceil((maxX - minX + margin * 2) / resolution);
  const rows = Math.ceil((maxY - minY + margin * 2) / resolution);

  // Initialize grid - everything blocked
  const grid: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(true));

  // Mark cells inside the room polygon as free
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = ox + c * resolution + resolution / 2;
      const wy = oy + r * resolution + resolution / 2;
      if (pointInPolygon({ x: wx, y: wy }, pts)) {
        grid[r][c] = false;
      }
    }
  }

  // Block cells near walls (within HALF_CORRIDOR) - to ensure corridor centerline stays far enough from walls
  // Actually we want the corridor CENTER to be at least HALF_CORRIDOR from walls
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) continue; // already blocked
      const wx = ox + c * resolution + resolution / 2;
      const wy = oy + r * resolution + resolution / 2;
      // Check distance to each wall edge
      const edgeCount = room.isClosed ? pts.length : pts.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dist = ptSegDist(wx, wy, a.x, a.y, b.x, b.y);
        if (dist < HALF_CORRIDOR) {
          grid[r][c] = true;
          break;
        }
      }
    }
  }

  // Block cells occupied by equipment (inflated by HALF_CORRIDOR)
  for (const eq of equipments) {
    const inflatedW = eq.width + CORRIDOR_WIDTH;
    const inflatedD = eq.depth + CORRIDOR_WIDTH;
    const rad = (eq.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const hw = inflatedW / 2, hd = inflatedD / 2;

    // Get bounding box in grid coords for efficiency
    const corners = [
      { x: -hw, y: -hd }, { x: hw, y: -hd },
      { x: hw, y: hd }, { x: -hw, y: hd },
    ].map(p => ({
      x: eq.position.x + p.x * cos - p.y * sin,
      y: eq.position.y + p.x * sin + p.y * cos,
    }));

    const cMinX = Math.min(...corners.map(p => p.x));
    const cMaxX = Math.max(...corners.map(p => p.x));
    const cMinY = Math.min(...corners.map(p => p.y));
    const cMaxY = Math.max(...corners.map(p => p.y));

    const c0 = Math.max(0, Math.floor((cMinX - ox) / resolution));
    const c1 = Math.min(cols - 1, Math.ceil((cMaxX - ox) / resolution));
    const r0 = Math.max(0, Math.floor((cMinY - oy) / resolution));
    const r1 = Math.min(rows - 1, Math.ceil((cMaxY - oy) / resolution));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const wx = ox + c * resolution + resolution / 2;
        const wy = oy + r * resolution + resolution / 2;
        // Transform to equipment local space
        const dx = wx - eq.position.x, dy = wy - eq.position.y;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hd) {
          grid[r][c] = true;
        }
      }
    }
  }

  // Block cells occupied by pillars (inflated by HALF_CORRIDOR)
  for (const pillar of pillars) {
    if (pillar.shape === "round") {
      const inflatedR = pillar.width / 2 + HALF_CORRIDOR;
      const c0 = Math.max(0, Math.floor((pillar.position.x - inflatedR - ox) / resolution));
      const c1 = Math.min(cols - 1, Math.ceil((pillar.position.x + inflatedR - ox) / resolution));
      const r0 = Math.max(0, Math.floor((pillar.position.y - inflatedR - oy) / resolution));
      const r1 = Math.min(rows - 1, Math.ceil((pillar.position.y + inflatedR - oy) / resolution));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const wx = ox + c * resolution + resolution / 2;
          const wy = oy + r * resolution + resolution / 2;
          const dist = Math.sqrt((wx - pillar.position.x) ** 2 + (wy - pillar.position.y) ** 2);
          if (dist < inflatedR) grid[r][c] = true;
        }
      }
    } else {
      const inflatedW = pillar.width + CORRIDOR_WIDTH;
      const inflatedD = pillar.depth + CORRIDOR_WIDTH;
      const rad = (pillar.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const hw = inflatedW / 2, hd = inflatedD / 2;
      const corners = [
        { x: -hw, y: -hd }, { x: hw, y: -hd },
        { x: hw, y: hd }, { x: -hw, y: hd },
      ].map(p => ({
        x: pillar.position.x + p.x * cos - p.y * sin,
        y: pillar.position.y + p.x * sin + p.y * cos,
      }));
      const cMinX = Math.min(...corners.map(p => p.x));
      const cMaxX = Math.max(...corners.map(p => p.x));
      const cMinY = Math.min(...corners.map(p => p.y));
      const cMaxY = Math.max(...corners.map(p => p.y));
      const c0 = Math.max(0, Math.floor((cMinX - ox) / resolution));
      const c1 = Math.min(cols - 1, Math.ceil((cMaxX - ox) / resolution));
      const r0 = Math.max(0, Math.floor((cMinY - oy) / resolution));
      const r1 = Math.min(rows - 1, Math.ceil((cMaxY - oy) / resolution));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const wx = ox + c * resolution + resolution / 2;
          const wy = oy + r * resolution + resolution / 2;
          const dx = wx - pillar.position.x, dy = wy - pillar.position.y;
          const lx = dx * cos + dy * sin;
          const ly = -dx * sin + dy * cos;
          if (Math.abs(lx) <= hw && Math.abs(ly) <= hd) grid[r][c] = true;
        }
      }
    }
  }

  return { grid, originX: ox, originY: oy, cols, rows, res: resolution };
}

/** A* pathfinding on the grid. Returns list of grid cells (row, col). */
function astar(
  grid: boolean[][],
  startR: number, startC: number,
  endR: number, endC: number,
  rows: number, cols: number,
): { r: number; c: number }[] | null {
  if (grid[startR]?.[startC] || grid[endR]?.[endC]) {
    // Start or end is blocked - try to find nearest unblocked cell
    const findNearest = (tr: number, tc: number): { r: number; c: number } | null => {
      for (let radius = 1; radius < 20; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            const nr = tr + dr, nc = tc + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !grid[nr][nc]) {
              return { r: nr, c: nc };
            }
          }
        }
      }
      return null;
    };
    if (grid[startR]?.[startC]) {
      const alt = findNearest(startR, startC);
      if (!alt) return null;
      startR = alt.r; startC = alt.c;
    }
    if (grid[endR]?.[endC]) {
      const alt = findNearest(endR, endC);
      if (!alt) return null;
      endR = alt.r; endC = alt.c;
    }
  }

  // 8-directional A*
  const dirs = [
    [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
    [-1, -1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [1, 1, 1.414],
  ];

  const heuristic = (r: number, c: number) => {
    const dr = Math.abs(r - endR), dc = Math.abs(c - endC);
    return Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc); // Octile distance
  };

  const key = (r: number, c: number) => r * cols + c;
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();

  const startKey = key(startR, startC);
  const endKey = key(endR, endC);
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(startR, startC));

  // Simple priority queue using sorted array (good enough for moderate grids)
  const openSet: { r: number; c: number; f: number }[] = [{ r: startR, c: startC, f: heuristic(startR, startC) }];
  const inOpen = new Set<number>([startKey]);

  while (openSet.length > 0) {
    // Find minimum f
    let minIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[minIdx].f) minIdx = i;
    }
    const current = openSet[minIdx];
    openSet.splice(minIdx, 1);
    const currentKey = key(current.r, current.c);
    inOpen.delete(currentKey);

    if (currentKey === endKey) {
      // Reconstruct path
      const path: { r: number; c: number }[] = [];
      let k = endKey;
      while (k !== undefined) {
        path.push({ r: Math.floor(k / cols), c: k % cols });
        k = cameFrom.get(k)!;
        if (k === startKey) { path.push({ r: startR, c: startC }); break; }
      }
      return path.reverse();
    }

    for (const [dr, dc, cost] of dirs) {
      const nr = current.r + dr, nc = current.c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc]) continue;

      const nKey = key(nr, nc);
      const tentG = (gScore.get(currentKey) ?? Infinity) + cost;
      if (tentG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentG);
        const f = tentG + heuristic(nr, nc);
        fScore.set(nKey, f);
        if (!inOpen.has(nKey)) {
          openSet.push({ r: nr, c: nc, f });
          inOpen.add(nKey);
        }
      }
    }
  }

  return null; // No path found
}

/** Smooth a path using Chaikin's corner-cutting algorithm, constrained to free cells */
function smoothPath(points: Point[], iterations: number = 3, isBlocked?: (p: Point) => boolean): Point[] {
  if (points.length < 3) return points;

  let current = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [current[0]]; // Keep start
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i], p1 = current[i + 1];
      const q: Point = {
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25,
      };
      const r: Point = {
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75,
      };
      // Only add smoothed point if it doesn't enter a blocked area
      next.push(isBlocked && isBlocked(q) ? p0 : q);
      next.push(isBlocked && isBlocked(r) ? p1 : r);
    }
    next.push(current[current.length - 1]); // Keep end
    current = next;
  }
  return current;
}

/** Simplify a path by removing collinear points (Douglas-Peucker) */
function simplifyPath(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;

  let maxDist = 0, maxIdx = 0;
  const start = points[0], end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = ptLineDist(points[i].x, points[i].y, start.x, start.y, end.x, end.y);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPath(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function ptLineDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  return Math.abs((py - ay) * dx - (px - ax) * dy) / len;
}

function ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
}

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

/** Get door position in world coords */
function getDoorWorldPosition(door: Door, rooms: Room[]): Point | null {
  const room = rooms.find(r => r.id === door.roomId);
  if (!room || door.edgeIndex >= room.points.length) return null;
  const a = room.points[door.edgeIndex];
  const b = room.points[(door.edgeIndex + 1) % room.points.length];
  return {
    x: a.x + (b.x - a.x) * door.positionRatio,
    y: a.y + (b.y - a.y) * door.positionRatio,
  };
}

/**
 * Build wall-sweep waypoints:
 *  - Groups equipment placed against the same wall.
 *  - Places ONE waypoint per equipment, aligned on a straight line parallel
 *    to the wall at a constant distance (the max front-face distance in the
 *    group + HALF_CORRIDOR + margin), sorted along the wall.
 *  - The forward direction of each equipment uses its real rotation
 *    (front = rotate((0,1), rotation)) and its real depth.
 *  - Center-placement (island) equipment get an individual front waypoint.
 */
function buildWallSweepWaypoints(
  equipments: PlacedEquipment[],
  room: Room,
): { id: string; point: Point }[] {
  if (equipments.length === 0) return [];

  const pts = room.points;
  const edgeCount = room.isClosed ? pts.length : pts.length - 1;

  type WallGroup = { edgeIdx: number; equipment: PlacedEquipment[] };
  const wallGroups = new Map<number, WallGroup>();

  for (const eq of equipments) {
    if (eq.centerPlacement) continue;
    let bestEdge = 0;
    let bestDist = Infinity;
    for (let i = 0; i < edgeCount; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dist = ptSegDist(eq.position.x, eq.position.y, a.x, a.y, b.x, b.y);
      if (dist < bestDist) { bestDist = dist; bestEdge = i; }
    }
    if (!wallGroups.has(bestEdge)) wallGroups.set(bestEdge, { edgeIdx: bestEdge, equipment: [] });
    wallGroups.get(bestEdge)!.equipment.push(eq);
  }

  const waypoints: { id: string; point: Point }[] = [];
  const frontMargin = HALF_CORRIDOR + 2;

  for (const [edgeIdx, group] of wallGroups) {
    const a = pts[edgeIdx], b = pts[(edgeIdx + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen === 0) continue;

    const ux = dx / wallLen, uy = dy / wallLen;
    let nx = -uy, ny = ux;
    const testPt = { x: (a.x + b.x) / 2 + nx * 50, y: (a.y + b.y) / 2 + ny * 50 };
    if (!pointInPolygon(testPt, pts)) { nx = -nx; ny = -ny; }

    // Compute per-equipment along/frontDist using real rotation + real depth.
    const projections = group.equipment.map(eq => {
      const px = eq.position.x - a.x, py = eq.position.y - a.y;
      const along = px * ux + py * uy;                    // pos along wall
      const eqDistFromWall = px * nx + py * ny;           // signed distance from wall (inward)
      const rad = (eq.rotation || 0) * Math.PI / 180;
      // Local +Y is the front direction; rotate it by eq.rotation.
      const frontX = -Math.sin(rad), frontY = Math.cos(rad);
      const frontProj = frontX * nx + frontY * ny;        // -1..1: how much front points inward
      // Signed distance from wall to the front face of the equipment.
      const frontFaceDist = eqDistFromWall + frontProj * (eq.depth / 2);
      // Also account for possibly-rotated side (width) if the game faces sideways.
      const sideProj = Math.abs(-Math.cos(rad) * nx + -Math.sin(rad) * ny); // |right·n|
      const bboxFrontDist = eqDistFromWall
        + Math.abs(frontProj) * (eq.depth / 2)
        + sideProj * (eq.width / 2);
      const clearance = Math.max(frontFaceDist, bboxFrontDist);
      return { eq, along, clearance };
    });
    projections.sort((p, q) => p.along - q.along);

    // Straight corridor line parallel to wall at constant distance.
    const wallLineDist = Math.max(
      HALF_CORRIDOR + 10,
      ...projections.map(p => p.clearance + frontMargin),
    );

    for (const proj of projections) {
      const clamped = Math.max(HALF_CORRIDOR + 30, Math.min(wallLen - HALF_CORRIDOR - 30, proj.along));
      waypoints.push({
        id: proj.eq.id,
        point: {
          x: a.x + ux * clamped + nx * wallLineDist,
          y: a.y + uy * clamped + ny * wallLineDist,
        },
      });
    }
  }

  // Island / center-placement equipment: one front waypoint each.
  for (const eq of equipments) {
    if (!eq.centerPlacement) continue;
    const rad = (eq.rotation || 0) * Math.PI / 180;
    const frontOffset = eq.depth / 2 + HALF_CORRIDOR + 2;
    waypoints.push({
      id: eq.id,
      point: {
        x: eq.position.x + (-Math.sin(rad)) * frontOffset,
        y: eq.position.y + Math.cos(rad) * frontOffset,
      },
    });
  }

  return waypoints;
}

/** Order waypoints along the room perimeter to create a smooth loop.
 *  Uses angle from room center, starting from the door's angle and going clockwise. */
function orderWaypointsPerimeter(start: Point, waypoints: { id: string; point: Point }[], roomCenter: Point): { id: string; point: Point }[] {
  if (waypoints.length <= 1) return [...waypoints];

  // Compute angle of start (door) relative to room center
  const startAngle = Math.atan2(start.y - roomCenter.y, start.x - roomCenter.x);

  // For each waypoint, compute its angle relative to room center
  // Normalize angles relative to startAngle so we go clockwise from the door
  const withAngles = waypoints.map(wp => {
    const angle = Math.atan2(wp.point.y - roomCenter.y, wp.point.x - roomCenter.x);
    // Normalize to [0, 2π) relative to start angle (clockwise)
    let relAngle = angle - startAngle;
    if (relAngle < 0) relAngle += Math.PI * 2;
    return { ...wp, relAngle };
  });

  // Sort by angle (clockwise from door)
  withAngles.sort((a, b) => a.relAngle - b.relAngle);

  return withAngles;
}

/**
 * Compute dynamic circulation paths.
 * Starts from the main door, visits the front of every equipment (2cm gap),
 * tries to loop back to the main door, otherwise backtracks.
 * Groups same-wall equipment to create sweep waypoints ensuring
 * the corridor visually passes in front of all equipment on each wall.
 */
export function computeCirculation(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
): CirculationResult {
  const emptyResult: CirculationResult = { segments: [], success: true, unreachableCount: 0, proposals: [] };
  if (rooms.length === 0) return emptyResult;

  // Find largest closed room
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
  if (!bestRoom) return emptyResult;

  const resolution = 10;
  const gridData = buildOccupancyGrid(bestRoom, equipments, pillars, doors, rooms, resolution);
  const { grid, originX, originY, cols, rows, res } = gridData;

  const toGrid = (wx: number, wy: number) => ({
    c: Math.floor((wx - originX) / res),
    r: Math.floor((wy - originY) / res),
  });
  const toWorld = (r: number, c: number): Point => ({
    x: originX + c * res + res / 2,
    y: originY + r * res + res / 2,
  });

  const isBlockedWorld = (p: Point): boolean => {
    const gc = Math.floor((p.x - originX) / res);
    const gr = Math.floor((p.y - originY) / res);
    if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return true;
    return grid[gr][gc];
  };

  // Find main door (or first door, or room center)
  const roomDoors = doors.filter(d => d.roomId === bestRoom!.id);
  const mainDoor = roomDoors.find(d => d.isMainDoor) || roomDoors[0];

  const getDoorEntry = (door: Door): Point => {
    const pos = getDoorWorldPosition(door, rooms);
    if (!pos) return bestRoom!.points.reduce((acc, p) => ({ x: acc.x + p.x / bestRoom!.points.length, y: acc.y + p.y / bestRoom!.points.length }), { x: 0, y: 0 });
    const a = bestRoom!.points[door.edgeIndex];
    const b = bestRoom!.points[(door.edgeIndex + 1) % bestRoom!.points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      let nx = -dy / len, ny = dx / len;
      const testIn = { x: pos.x + nx * 50, y: pos.y + ny * 50 };
      if (!pointInPolygon(testIn, bestRoom!.points)) {
        nx = -nx; ny = -ny;
      }
      // Step inward just enough to be inside the room and in a free grid cell
      // Use a small offset (30cm) to avoid wall-blocked cells, then A* handles the rest
      return { x: pos.x + nx * 30, y: pos.y + ny * 30 };
    }
    return pos;
  };

  let startPos: Point;
  if (mainDoor) {
    startPos = getDoorEntry(mainDoor);
  } else {
    const pts = bestRoom.points;
    startPos = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }

  const allSegments: CirculationSegment[] = [];
  const unreachableIds: string[] = [];

  const buildPath = (from: Point, to: Point): boolean => {
    const fromGrid = toGrid(from.x, from.y);
    const toGrid_ = toGrid(to.x, to.y);
    const pathCells = astar(grid, fromGrid.r, fromGrid.c, toGrid_.r, toGrid_.c, rows, cols);
    if (!pathCells || pathCells.length < 2) return false;
    const worldPoints = pathCells.map(cell => toWorld(cell.r, cell.c));
    const simplified = simplifyPath(worldPoints, resolution * 0.8);
    const smoothed = sampleSpline(simplified, 10, isBlockedWorld);
    for (let i = 0; i < smoothed.length - 1; i++) {
      allSegments.push({ start: smoothed[i], end: smoothed[i + 1], width: CORRIDOR_WIDTH });
    }
    return true;
  };

  const applyTurningZones = (segments: CirculationSegment[]) => {
    if (segments.length === 0) return;
    const n = Math.min(TURNING_ZONE_SEGMENTS, Math.floor(segments.length / 2));
    for (let i = 0; i < n; i++) {
      segments[i].width = TURNING_ZONE_WIDTH;
    }
    for (let i = segments.length - n; i < segments.length; i++) {
      segments[i].width = TURNING_ZONE_WIDTH;
    }
  };

  if (equipments.length > 0) {
    // Build wall-sweep waypoints (groups same-wall equipment, creates sweep at extremes)
    const waypoints = buildWallSweepWaypoints(equipments, bestRoom);

    // Deduplicate waypoints that share the same point (from sweep grouping)
    const uniqueWaypoints: { id: string; point: Point }[] = [];
    const seenPoints = new Set<string>();
    for (const wp of waypoints) {
      const key = `${Math.round(wp.point.x)},${Math.round(wp.point.y)}`;
      if (!seenPoints.has(key)) {
        seenPoints.add(key);
        uniqueWaypoints.push(wp);
      }
    }

    // Compute room center for perimeter ordering
    const roomPts = bestRoom!.points;
    const roomCenter: Point = {
      x: roomPts.reduce((s, p) => s + p.x, 0) / roomPts.length,
      y: roomPts.reduce((s, p) => s + p.y, 0) / roomPts.length,
    };

    // Order waypoints along the perimeter (clockwise loop from door)
    const orderedWithIds = orderWaypointsPerimeter(startPos, uniqueWaypoints, roomCenter);

    // Build path: door → wp1 → wp2 → ... → wpN → door (loop)
    let currentPos = startPos;
    for (const wp of orderedWithIds) {
      const ok = buildPath(currentPos, wp.point);
      if (!ok) {
        unreachableIds.push(wp.id);
      } else {
        currentPos = wp.point;
      }
    }

    // Close the loop: return to door for a clean circuit
    if (mainDoor && orderedWithIds.length > 0) {
      buildPath(currentPos, startPos);
    }

    // Map back: any equipment whose waypoint was unreachable
    const coveredIds = new Set(waypoints.filter(w => !unreachableIds.includes(w.id)).map(w => w.id));
    for (const eq of equipments) {
      if (!coveredIds.has(eq.id) && !unreachableIds.includes(eq.id)) {
        unreachableIds.push(eq.id);
      }
    }
  } else if (roomDoors.length === 0) {
    // No doors, no equipment — nothing to show
  }

  // Apply turning zones (1.4m) at corridor extremities
  applyTurningZones(allSegments);

  const success = unreachableIds.length === 0;
  let proposals: RemovalProposal[] = [];
  if (!success && equipments.length > 0) {
    proposals = generateRemovalProposals(rooms, doors, pillars, equipments, unreachableIds);
  }

  return { segments: allSegments, success, unreachableCount: unreachableIds.length, proposals };
}

/** Generate up to 3 removal proposals that restore circulation */
function generateRemovalProposals(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
  unreachableIds: string[],
): RemovalProposal[] {
  const proposals: RemovalProposal[] = [];

  // Strategy 1: Remove only the unreachable equipment
  {
    const remaining = equipments.filter(e => !unreachableIds.includes(e.id));
    const removed = equipments.filter(e => unreachableIds.includes(e.id));
    const testResult = computeCirculationSimple(rooms, doors, pillars, remaining);
    if (testResult.success) {
      proposals.push({
        id: crypto.randomUUID(),
        label: `Retirer ${removed.length} jeu(x) inaccessible(s)`,
        equipmentIdsToRemove: unreachableIds,
        removedNames: removed.map(e => e.name),
        resultingCirculation: testResult.segments,
        remainingEquipments: remaining,
      });
    }
  }

  // Strategy 2: Remove equipment one by one (largest first by area) until circulation works
  {
    const sorted = [...equipments].sort((a, b) => (b.width * b.depth) - (a.width * a.depth));
    const toRemove: string[] = [];
    const removedNames: string[] = [];
    for (const eq of sorted) {
      toRemove.push(eq.id);
      removedNames.push(eq.name);
      const remaining = equipments.filter(e => !toRemove.includes(e.id));
      const testResult = computeCirculationSimple(rooms, doors, pillars, remaining);
      if (testResult.success) {
        // Don't duplicate strategy 1
        if (toRemove.length !== unreachableIds.length || !toRemove.every(id => unreachableIds.includes(id))) {
          proposals.push({
            id: crypto.randomUUID(),
            label: `Retirer ${toRemove.length} jeu(x) (les plus encombrants)`,
            equipmentIdsToRemove: [...toRemove],
            removedNames: [...removedNames],
            resultingCirculation: testResult.segments,
            remainingEquipments: remaining,
          });
        }
        break;
      }
      if (toRemove.length >= 5) break; // limit search
    }
  }

  // Strategy 3: Remove equipment closest to center (likely blocking passage)
  {
    const pts = rooms.find(r => r.isClosed)?.points;
    if (pts) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const sorted = [...equipments].sort((a, b) => {
        const da = (a.position.x - cx) ** 2 + (a.position.y - cy) ** 2;
        const db = (b.position.x - cx) ** 2 + (b.position.y - cy) ** 2;
        return da - db;
      });
      const toRemove: string[] = [];
      const removedNames: string[] = [];
      for (const eq of sorted) {
        toRemove.push(eq.id);
        removedNames.push(eq.name);
        const remaining = equipments.filter(e => !toRemove.includes(e.id));
        const testResult = computeCirculationSimple(rooms, doors, pillars, remaining);
        if (testResult.success) {
          const isDuplicate = proposals.some(p =>
            p.equipmentIdsToRemove.length === toRemove.length &&
            p.equipmentIdsToRemove.every(id => toRemove.includes(id))
          );
          if (!isDuplicate) {
            proposals.push({
              id: crypto.randomUUID(),
              label: `Retirer ${toRemove.length} jeu(x) au centre de la salle`,
              equipmentIdsToRemove: [...toRemove],
              removedNames: [...removedNames],
              resultingCirculation: testResult.segments,
              remainingEquipments: remaining,
            });
          }
          break;
        }
        if (toRemove.length >= 5) break;
      }
    }
  }

  return proposals.slice(0, 3);
}

/** Simplified computeCirculation that just returns segments + success (no proposals to avoid recursion) */
function computeCirculationSimple(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
): { segments: CirculationSegment[]; success: boolean } {
  if (rooms.length === 0) return { segments: [], success: true };

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
  if (!bestRoom) return { segments: [], success: true };

  const resolution = 20;
  const gridData = buildOccupancyGrid(bestRoom, equipments, pillars, doors, rooms, resolution);
  const { grid, originX, originY, cols, rows, res } = gridData;

  const toGrid = (wx: number, wy: number) => ({
    c: Math.floor((wx - originX) / res),
    r: Math.floor((wy - originY) / res),
  });
  const toWorld = (r: number, c: number): Point => ({
    x: originX + c * res + res / 2,
    y: originY + r * res + res / 2,
  });

  const roomDoors = doors.filter(d => d.roomId === bestRoom!.id);
  const doorPositions: Point[] = [];
  for (const door of roomDoors) {
    const pos = getDoorWorldPosition(door, rooms);
    if (pos) {
      const a = bestRoom.points[door.edgeIndex];
      const b = bestRoom.points[(door.edgeIndex + 1) % bestRoom.points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = -dy / len, ny = dx / len;
        const testIn = { x: pos.x + nx * 50, y: pos.y + ny * 50 };
        if (pointInPolygon(testIn, bestRoom.points)) {
          doorPositions.push({ x: pos.x + nx * HALF_CORRIDOR, y: pos.y + ny * HALF_CORRIDOR });
        } else {
          doorPositions.push({ x: pos.x - nx * HALF_CORRIDOR, y: pos.y - ny * HALF_CORRIDOR });
        }
      } else { doorPositions.push(pos); }
    }
  }
  if (doorPositions.length === 0) {
    const pts = bestRoom.points;
    doorPositions.push({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
  }

  const allSegments: CirculationSegment[] = [];
  const startPos = doorPositions[0];
  let unreachableCount = 0;

  const buildPath = (from: Point, to: Point): boolean => {
    const fromGrid = toGrid(from.x, from.y);
    const toGrid_ = toGrid(to.x, to.y);
    const pathCells = astar(grid, fromGrid.r, fromGrid.c, toGrid_.r, toGrid_.c, rows, cols);
    if (!pathCells || pathCells.length < 2) return false;
    const worldPoints = pathCells.map(cell => toWorld(cell.r, cell.c));
    const simplified = simplifyPath(worldPoints, resolution * 0.8);
    const smoothed = smoothPath(simplified, 2);
    for (let i = 0; i < smoothed.length - 1; i++) {
      allSegments.push({ start: smoothed[i], end: smoothed[i + 1], width: CORRIDOR_WIDTH });
    }
    return true;
  };

  if (equipments.length > 0) {
    const sortedEquipments = [...equipments].sort((a, b) => {
      const da = (a.position.x - startPos.x) ** 2 + (a.position.y - startPos.y) ** 2;
      const db = (b.position.x - startPos.x) ** 2 + (b.position.y - startPos.y) ** 2;
      return da - db;
    });
    let currentPos = startPos;
    for (const eq of sortedEquipments) {
      const ok = buildPath(currentPos, eq.position);
      if (!ok) { unreachableCount++; } else { currentPos = eq.position; }
    }
  }

  for (let di = 1; di < doorPositions.length; di++) {
    buildPath(doorPositions[di], startPos);
  }

  return { segments: allSegments, success: unreachableCount === 0 };
}
