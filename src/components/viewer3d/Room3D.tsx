import { useMemo } from "react";
import * as THREE from "three";
import type { Room, Door } from "@/types/editor";

const WALL_HEIGHT = 2.8; // meters
const WALL_THICKNESS = 0.15; // meters

type Props = {
  room: Room;
  doors: Door[];
  showFloor?: boolean;
  showWalls?: boolean;
};

export function Room3D({ room, doors, showFloor = true, showWalls = true }: Props) {
  const { floorShape, wallMeshes } = useMemo(() => {
    // Convert cm → meters, 2D y → 3D z
    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));

    // Floor shape
    const floorShape = new THREE.Shape(pts);

    // Build wall segments
    const walls: { start: THREE.Vector2; end: THREE.Vector2 }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const next = (i + 1) % pts.length;
      if (!room.isClosed && i === pts.length - 1) break;
      walls.push({ start: pts[i], end: pts[next] });
    }

    // Build wall geometries, cutting door openings
    const wallMeshes = walls.map((wall, edgeIndex) => {
      const dx = wall.end.x - wall.start.x;
      const dz = wall.end.y - wall.start.y;
      const wallLength = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);

      // Find doors on this edge
      const edgeDoors = doors.filter(
        (d) => d.roomId === room.id && d.edgeIndex === edgeIndex
      );

      // Sort doors by position ratio
      const sorted = [...edgeDoors].sort((a, b) => a.positionRatio - b.positionRatio);

      // Create wall segments between doors
      const segments: { start: number; end: number }[] = [];
      let cursor = 0;
      for (const door of sorted) {
        const doorWidthM = door.width / 100;
        const doorCenter = door.positionRatio * wallLength;
        const doorStart = doorCenter - doorWidthM / 2;
        const doorEnd = doorCenter + doorWidthM / 2;
        if (doorStart > cursor + 0.01) {
          segments.push({ start: cursor, end: doorStart });
        }
        cursor = doorEnd;
      }
      if (cursor < wallLength - 0.01) {
        segments.push({ start: cursor, end: wallLength });
      }

      return { segments, wallLength, angle, origin: wall.start, edgeIndex };
    });

    return { floorShape, wallMeshes };
  }, [room, doors]);

  return (
    <group>
      {/* Floor */}
      {showFloor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <shapeGeometry args={[floorShape]} />
          <meshStandardMaterial
            color="#e8e8e8"
            roughness={0.5}
            metalness={0.05}
            {...{} as any}
          />
        </mesh>
      )}

      {/* Walls */}
      {showWalls && wallMeshes.map((wall, wi) =>
        wall.segments.map((seg, si) => {
          const segLength = seg.end - seg.start;
          const segCenter = (seg.start + seg.end) / 2;
          const cx = wall.origin.x + Math.cos(wall.angle) * segCenter;
          const cz = wall.origin.y + Math.sin(wall.angle) * segCenter;

          return (
            <mesh
              key={`wall-${wi}-${si}`}
              position={[cx, WALL_HEIGHT / 2, cz]}
              rotation={[0, -wall.angle, 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[segLength, WALL_HEIGHT, WALL_THICKNESS]} />
              <meshStandardMaterial
                color="#f0f0f0"
                roughness={0.8}
                metalness={0.02}
                {...{} as any}
              />
            </mesh>
          );
        })
      )}
    </group>
  );
}
