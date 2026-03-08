import type { Point, Room, Door, Pillar } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";

const CORRIDOR_WIDTH = 140; // 1.40m in cm
const HALF_CORRIDOR = CORRIDOR_WIDTH / 2; // 70cm

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
 * Compute dynamic circulation paths that navigate from doors
 * through the room, contouring around all obstacles with 1.40m width.
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

  const resolution = 10; // finer grid for smoother, non-snapped paths
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

  // Door positions
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
      } else {
        doorPositions.push(pos);
      }
    }
  }
  if (doorPositions.length === 0) {
    const pts = bestRoom.points;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    doorPositions.push({ x: cx, y: cy });
  }

  const allSegments: CirculationSegment[] = [];
  const startPos = doorPositions[0];
  const endPos = doorPositions.length > 1 ? doorPositions[doorPositions.length - 1] : null;
  const unreachableIds: string[] = [];

  // Check if a world point falls in a blocked grid cell
  const isBlockedWorld = (p: Point): boolean => {
    const gc = Math.floor((p.x - originX) / res);
    const gr = Math.floor((p.y - originY) / res);
    if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return true;
    return grid[gr][gc];
  };

  const buildPath = (from: Point, to: Point): boolean => {
    const fromGrid = toGrid(from.x, from.y);
    const toGrid_ = toGrid(to.x, to.y);
    const pathCells = astar(grid, fromGrid.r, fromGrid.c, toGrid_.r, toGrid_.c, rows, cols);
    if (!pathCells || pathCells.length < 2) return false;
    const worldPoints = pathCells.map(cell => toWorld(cell.r, cell.c));
    const simplified = simplifyPath(worldPoints, resolution * 0.8);
    const smoothed = smoothPath(simplified, 3, isBlockedWorld);
    for (let i = 0; i < smoothed.length - 1; i++) {
      allSegments.push({ start: smoothed[i], end: smoothed[i + 1], width: CORRIDOR_WIDTH });
    }
    return true;
  };

  if (equipments.length > 0) {
    // If we have 2+ doors, sort equipments along the axis between first and last door
    // so the path naturally flows door1 → equipments → door2
    let sortedEquipments: PlacedEquipment[];
    if (endPos) {
      const axisX = endPos.x - startPos.x;
      const axisY = endPos.y - startPos.y;
      const axisLen2 = axisX * axisX + axisY * axisY;
      if (axisLen2 > 0) {
        sortedEquipments = [...equipments].sort((a, b) => {
          const ta = ((a.position.x - startPos.x) * axisX + (a.position.y - startPos.y) * axisY) / axisLen2;
          const tb = ((b.position.x - startPos.x) * axisX + (b.position.y - startPos.y) * axisY) / axisLen2;
          return ta - tb;
        });
      } else {
        sortedEquipments = [...equipments].sort((a, b) => {
          const da = (a.position.x - startPos.x) ** 2 + (a.position.y - startPos.y) ** 2;
          const db = (b.position.x - startPos.x) ** 2 + (b.position.y - startPos.y) ** 2;
          return da - db;
        });
      }
    } else {
      sortedEquipments = [...equipments].sort((a, b) => {
        const da = (a.position.x - startPos.x) ** 2 + (a.position.y - startPos.y) ** 2;
        const db = (b.position.x - startPos.x) ** 2 + (b.position.y - startPos.y) ** 2;
        return da - db;
      });
    }

    let currentPos = startPos;
    for (const eq of sortedEquipments) {
      const ok = buildPath(currentPos, eq.position);
      if (!ok) {
        unreachableIds.push(eq.id);
      } else {
        currentPos = eq.position;
      }
    }

    // After visiting all equipments, connect to the last door (and any intermediate doors)
    if (endPos) {
      buildPath(currentPos, endPos);
    }
    // Connect any intermediate doors (index 1 to length-2) to the main path
    for (let di = 1; di < doorPositions.length - 1; di++) {
      // Find the nearest point on the main chain to branch from
      buildPath(doorPositions[di], startPos);
    }
  } else {
    // No equipment — connect doors directly if multiple
    if (endPos) {
      buildPath(startPos, endPos);
    }
    // Connect intermediate doors
    for (let di = 1; di < doorPositions.length - 1; di++) {
      buildPath(doorPositions[di], startPos);
    }

    // If only one door (or after door connections), basic room traversal
    if (doorPositions.length <= 1) {
      const pts = bestRoom.points;
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y));
      const roomW = maxX - minX, roomH = maxY - minY;

      const farCorners = [
        { x: minX + HALF_CORRIDOR + 20, y: minY + HALF_CORRIDOR + 20 },
        { x: maxX - HALF_CORRIDOR - 20, y: minY + HALF_CORRIDOR + 20 },
        { x: maxX - HALF_CORRIDOR - 20, y: maxY - HALF_CORRIDOR - 20 },
        { x: minX + HALF_CORRIDOR + 20, y: maxY - HALF_CORRIDOR - 20 },
        { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      ].filter(p => pointInPolygon(p, pts));

      farCorners.sort((a, b) => {
        const da = (a.x - startPos.x) ** 2 + (a.y - startPos.y) ** 2;
        const db = (b.x - startPos.x) ** 2 + (b.y - startPos.y) ** 2;
        return db - da;
      });

      if (farCorners.length > 0) {
        buildPath(startPos, farCorners[0]);
        if (roomW > CORRIDOR_WIDTH * 3 && roomH > CORRIDOR_WIDTH * 3 && farCorners.length > 1) {
          const farthest = farCorners[0];
          const mainDx = farthest.x - startPos.x;
          const mainDy = farthest.y - startPos.y;
          const mainLen = Math.sqrt(mainDx * mainDx + mainDy * mainDy) || 1;
          let bestPerp: Point | null = null;
          let bestPerpDist = 0;
          for (const corner of farCorners.slice(1)) {
            const t = ((corner.x - startPos.x) * mainDx + (corner.y - startPos.y) * mainDy) / (mainLen * mainLen);
            const projX = startPos.x + t * mainDx;
            const projY = startPos.y + t * mainDy;
            const perpDist = Math.sqrt((corner.x - projX) ** 2 + (corner.y - projY) ** 2);
            if (perpDist > bestPerpDist) { bestPerpDist = perpDist; bestPerp = corner; }
          }
          if (bestPerp && bestPerpDist > CORRIDOR_WIDTH) {
            buildPath({ x: (startPos.x + farthest.x) / 2, y: (startPos.y + farthest.y) / 2 }, bestPerp);
          }
        }
      }
    }
  }

  const success = unreachableIds.length === 0;

  // Generate removal proposals if circulation failed
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
    const smoothed = smoothPath(simplified, 3);
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
