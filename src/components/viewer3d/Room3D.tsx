import { useMemo } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import type { Room, Door } from "@/types/editor";
import type { AmbianceSettings, FloorTexture, WallFinish } from "./Viewer3DToolbar";

const WALL_HEIGHT = 2.8; // meters
const WALL_THICKNESS = 0.15; // meters

const FLOOR_TEXTURE_MAP: Record<Exclude<FloorTexture, "default">, string> = {
  carpet: "/textures/floor_carpet_arcade.jpg",
  epoxy: "/textures/floor_epoxy.jpg",
  concrete: "/textures/floor_concrete.jpg",
  parquet: "/textures/floor_parquet.jpg",
  vinyl: "/textures/floor_vinyl.jpg",
  tile: "/textures/floor_tile.jpg",
};

const WALL_TEXTURE_MAP: Record<Exclude<WallFinish, "default" | "paint">, string> = {
  brick: "/textures/wall_brick.jpg",
  concrete: "/textures/wall_concrete.jpg",
  wood: "/textures/wall_wood.jpg",
};

/** Load and configure a tileable texture */
function useTileableTexture(path: string | null, repeatX = 4, repeatY = 4): THREE.Texture | null {
  // Always call useLoader but with a fallback — we handle null below
  const texture = useLoader(
    THREE.TextureLoader,
    path || "/placeholder.svg"
  );

  return useMemo(() => {
    if (!path || !texture) return null;
    const t = texture.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [texture, path, repeatX, repeatY]);
}

type Props = {
  room: Room;
  doors: Door[];
  showFloor?: boolean;
  showWalls?: boolean;
  ambiance?: AmbianceSettings;
};

export function Room3D({ room, doors, showFloor = true, showWalls = true, ambiance }: Props) {
  const floorTextureKey = ambiance?.floorTexture && ambiance.floorTexture !== "default"
    ? FLOOR_TEXTURE_MAP[ambiance.floorTexture]
    : null;
  const wallTextureKey = ambiance?.wallFinish && ambiance.wallFinish !== "default" && ambiance.wallFinish !== "paint"
    ? WALL_TEXTURE_MAP[ambiance.wallFinish]
    : null;

  const floorTex = useTileableTexture(floorTextureKey, 4, 4);
  const wallTex = useTileableTexture(wallTextureKey, 3, 1);

  const wallColor = ambiance?.wallFinish === "paint" ? ambiance.wallColor : "#f0f0f0";

  const { floorShape, wallMeshes } = useMemo(() => {
    // Convert cm → meters, 2D y → 3D z
    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));

    // Floor shape — negate Y to compensate for -PI/2 X rotation (which maps shape Y → -Z)
    const floorPts = room.points.map((p) => new THREE.Vector2(p.x / 100, -p.y / 100));
    floorPts.reverse(); // preserve correct winding after negation
    const floorShape = new THREE.Shape(floorPts);

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
      {/* Floor — thin slab flush with Y=0 on top, extruded downward */}
      {showFloor && (
        <group>
          {/* Top surface at Y=0 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
            <shapeGeometry args={[floorShape]} />
            <meshStandardMaterial
              color={floorTex ? "#ffffff" : "#e8e8e8"}
              map={floorTex}
              roughness={0.5}
              metalness={0.05}
              side={THREE.DoubleSide}
              {...{} as any}
            />
          </mesh>
          {/* Slab sides (extruded downward) for visibility from low angles */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
            <extrudeGeometry args={[floorShape, { depth: 0.05, bevelEnabled: false }]} />
            <meshStandardMaterial
              color="#d4d4d4"
              roughness={0.6}
              metalness={0.05}
              side={THREE.DoubleSide}
              {...{} as any}
            />
          </mesh>
        </group>
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
                color={wallTex ? "#ffffff" : wallColor}
                map={wallTex}
                roughness={wallTex ? 0.7 : 0.8}
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
