import { useMemo, Suspense } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import type { Room, Door } from "@/types/editor";
import type { AmbianceSettings, FloorTexture, WallFinish, PolyHavenTexture } from "./Viewer3DToolbar";

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

type Props = {
  room: Room;
  doors: Door[];
  showFloor?: boolean;
  showWalls?: boolean;
  ambiance?: AmbianceSettings;
};

/** Inner component that loads and applies a floor texture */
function TexturedFloor({ shape, texturePath }: { shape: THREE.Shape; texturePath: string }) {
  const texture = useLoader(THREE.TextureLoader, texturePath);
  const tex = useMemo(() => {
    const t = texture.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.5, 0.5); // 1 repeat per 2 meters
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [texture]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        map={tex}
        color="#ffffff"
        roughness={0.5}
        metalness={0.05}
        side={THREE.DoubleSide}
        {...{} as any}
      />
    </mesh>
  );
}

/** Inner component that loads and applies a wall texture */
function TexturedWallSegment({
  position,
  rotation,
  size,
  texturePath,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  texturePath: string;
}) {
  const texture = useLoader(THREE.TextureLoader, texturePath);
  const tex = useMemo(() => {
    const t = texture.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(size[0] * 1.5, size[1] * 0.5);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [texture, size[0], size[1]]);

  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        map={tex}
        color="#ffffff"
        roughness={0.7}
        metalness={0.02}
        {...{} as any}
      />
    </mesh>
  );
}

export function Room3D({ room, doors, showFloor = true, showWalls = true, ambiance }: Props) {
  const wallHeight = ambiance?.wallHeight ?? 2.8;
  // Epoxy is best rendered as a smooth procedural material, not a tiled texture
  const isEpoxy = ambiance?.floorTexture === "epoxy";
  const floorTexturePath = ambiance?.floorTexture && ambiance.floorTexture !== "default" && !isEpoxy
    ? FLOOR_TEXTURE_MAP[ambiance.floorTexture]
    : null;
  const wallTexturePath = ambiance?.wallFinish && ambiance.wallFinish !== "default" && ambiance.wallFinish !== "paint"
    ? WALL_TEXTURE_MAP[ambiance.wallFinish]
    : null;
  const wallColor = ambiance?.wallFinish === "paint" ? ambiance.wallColor : "#f0f0f0";

  const { floorShape, wallMeshes } = useMemo(() => {
    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));
    const floorPts = room.points.map((p) => new THREE.Vector2(p.x / 100, -p.y / 100));
    floorPts.reverse();
    const floorShape = new THREE.Shape(floorPts);

    const walls: { start: THREE.Vector2; end: THREE.Vector2 }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const next = (i + 1) % pts.length;
      if (!room.isClosed && i === pts.length - 1) break;
      walls.push({ start: pts[i], end: pts[next] });
    }

    const wallMeshes = walls.map((wall, edgeIndex) => {
      const dx = wall.end.x - wall.start.x;
      const dz = wall.end.y - wall.start.y;
      const wallLength = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);

      const edgeDoors = doors.filter(
        (d) => d.roomId === room.id && d.edgeIndex === edgeIndex
      );
      const sorted = [...edgeDoors].sort((a, b) => a.positionRatio - b.positionRatio);

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
        <group>
          {/* Textured surface, epoxy, or default */}
          {floorTexturePath ? (
            <TexturedFloor shape={floorShape} texturePath={floorTexturePath} />
          ) : isEpoxy ? (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
              <shapeGeometry args={[floorShape]} />
              <meshPhysicalMaterial
                color="#7a7a7f"
                roughness={0.12}
                metalness={0.08}
                clearcoat={0.9}
                clearcoatRoughness={0.05}
                reflectivity={0.6}
                side={THREE.DoubleSide}
                {...{} as any}
              />
            </mesh>
          ) : (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
              <shapeGeometry args={[floorShape]} />
              <meshStandardMaterial
                color="#e8e8e8"
                roughness={0.5}
                metalness={0.05}
                side={THREE.DoubleSide}
                {...{} as any}
              />
            </mesh>
          )}
          {/* Slab sides */}
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
          const pos: [number, number, number] = [cx, wallHeight / 2, cz];
          const rot: [number, number, number] = [0, -wall.angle, 0];
          const size: [number, number, number] = [segLength, wallHeight, WALL_THICKNESS];

          if (wallTexturePath) {
            return (
              <TexturedWallSegment
                key={`wall-${wi}-${si}`}
                position={pos}
                rotation={rot}
                size={size}
                texturePath={wallTexturePath}
              />
            );
          }

          return (
            <mesh
              key={`wall-${wi}-${si}`}
              position={pos}
              rotation={rot}
              castShadow
              receiveShadow
            >
              <boxGeometry args={size} />
              <meshStandardMaterial
                color={wallColor}
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
