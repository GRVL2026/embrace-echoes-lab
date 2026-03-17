import { useMemo, Suspense } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import type { Room, Door } from "@/types/editor";
import type { AmbianceSettings, FloorTexture, WallFinish, PolyHavenTexture } from "./Viewer3DToolbar";
import { AntiTileMaterial } from "./AntiTileMaterial";

const WALL_THICKNESS = 0.15; // meters

/** Physical size of one texture tile in meters – adjusting this changes how "zoomed" textures appear */
const TEXTURE_PHYSICAL_SIZE = 2.0; // 1 tile covers 2m

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

/**
 * Configure a texture for physically-correct tiling.
 * repeatX/Y = surface dimension / physical tile size.
 * An optional UV offset breaks visible repetition.
 */
function configureTexture(
  t: THREE.Texture,
  surfaceWidth: number,
  surfaceHeight: number,
  offsetX = 0,
  offsetY = 0,
  rotationStep = 0,
): THREE.Texture {
  const c = t.clone();
  c.wrapS = THREE.RepeatWrapping;
  c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(
    surfaceWidth / TEXTURE_PHYSICAL_SIZE,
    surfaceHeight / TEXTURE_PHYSICAL_SIZE,
  );
  c.offset.set(offsetX, offsetY);
  c.center.set(0.5, 0.5);
  c.rotation = (rotationStep % 4) * (Math.PI / 2);
  c.colorSpace = THREE.SRGBColorSpace;
  c.needsUpdate = true;
  return c;
}

/** Hash a number pair into a deterministic 0-1 value for anti-tiling offset */
function pseudoRandom(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

type Props = {
  room: Room;
  doors: Door[];
  showFloor?: boolean;
  showWalls?: boolean;
  ambiance?: AmbianceSettings;
};

/** Inner component that loads and applies a floor texture */
function TexturedFloor({ shape, texturePath, surfaceSize }: { shape: THREE.Shape; texturePath: string; surfaceSize: [number, number] }) {
  const texture = useLoader(THREE.TextureLoader, texturePath);
  const tex = useMemo(() => {
    const rot = Math.floor(pseudoRandom(surfaceSize[0], surfaceSize[1]) * 4);
    return configureTexture(texture, surfaceSize[0], surfaceSize[1], 0, 0, rot);
  }, [texture, surfaceSize[0], surfaceSize[1]]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <AntiTileMaterial
        map={tex}
        color="#ffffff"
        roughness={0.5}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Component that loads PBR textures from Poly Haven URLs */
function PolyHavenSurface({
  shape,
  position,
  rotation,
  textureData,
  surfaceSize,
}: {
  shape?: THREE.Shape;
  position: [number, number, number];
  rotation: [number, number, number];
  textureData: PolyHavenTexture;
  surfaceSize: [number, number];
}) {
  const urls = textureData.urls;
  const diffuseTex = useLoader(THREE.TextureLoader, urls.diffuse || "");
  const normalTex = urls.normal ? useLoader(THREE.TextureLoader, urls.normal) : null;
  const roughTex = urls.roughness ? useLoader(THREE.TextureLoader, urls.roughness) : null;

  const mats = useMemo(() => {
    const rot = Math.floor(pseudoRandom(surfaceSize[0] * 7, surfaceSize[1] * 13) * 4);
    return {
      diffuse: configureTexture(diffuseTex, surfaceSize[0], surfaceSize[1], 0, 0, rot),
      normal: normalTex ? configureTexture(normalTex, surfaceSize[0], surfaceSize[1], 0, 0, rot) : null,
      roughness: roughTex ? configureTexture(roughTex, surfaceSize[0], surfaceSize[1], 0, 0, rot) : null,
    };
  }, [diffuseTex, normalTex, roughTex, surfaceSize[0], surfaceSize[1]]);

  if (shape) {
    return (
      <mesh rotation={rotation} position={position} receiveShadow>
        <shapeGeometry args={[shape]} />
        <AntiTileMaterial
          map={mats.diffuse}
          normalMap={mats.normal}
          roughnessMap={mats.roughness}
          roughness={mats.roughness ? 1 : 0.5}
          metalness={0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  }
  return null;
}

/** Box surface with Poly Haven PBR textures – anti-tiling via per-segment UV offset */
function PolyHavenWallSegment({
  position,
  rotation,
  size,
  textureData,
  segmentIndex,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  textureData: PolyHavenTexture;
  segmentIndex: number;
}) {
  const urls = textureData.urls;
  const diffuseTex = useLoader(THREE.TextureLoader, urls.diffuse || "");
  const normalTex = urls.normal ? useLoader(THREE.TextureLoader, urls.normal) : null;
  const roughTex = urls.roughness ? useLoader(THREE.TextureLoader, urls.roughness) : null;

  const mats = useMemo(() => {
    const ox = pseudoRandom(segmentIndex, 0);
    const oy = pseudoRandom(segmentIndex, 1);
    const rot = Math.floor(pseudoRandom(segmentIndex, 4) * 4);
    return {
      diffuse: configureTexture(diffuseTex, size[0], size[1], ox, oy, rot),
      normal: normalTex ? configureTexture(normalTex, size[0], size[1], ox, oy, rot) : null,
      roughness: roughTex ? configureTexture(roughTex, size[0], size[1], ox, oy, rot) : null,
    };
  }, [diffuseTex, normalTex, roughTex, size[0], size[1], segmentIndex]);

  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <AntiTileMaterial
        map={mats.diffuse}
        normalMap={mats.normal}
        roughnessMap={mats.roughness}
        roughness={mats.roughness ? 1 : 0.7}
        metalness={0.02}
      />
    </mesh>
  );
}

/** Inner component that loads and applies a wall texture with anti-tiling */
function TexturedWallSegment({
  position,
  rotation,
  size,
  texturePath,
  segmentIndex,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  texturePath: string;
  segmentIndex: number;
}) {
  const texture = useLoader(THREE.TextureLoader, texturePath);
  const tex = useMemo(() => {
    const ox = pseudoRandom(segmentIndex, 2);
    const oy = pseudoRandom(segmentIndex, 3);
    return configureTexture(texture, size[0], size[1], ox, oy);
  }, [texture, size[0], size[1], segmentIndex]);

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
  const polyFloor = ambiance?.polyhavenFloor;
  const polyWall = ambiance?.polyhavenWall;
  const isEpoxy = !polyFloor && ambiance?.floorTexture === "epoxy";
  const floorTexturePath = !polyFloor && ambiance?.floorTexture && ambiance.floorTexture !== "default" && !isEpoxy
    ? FLOOR_TEXTURE_MAP[ambiance.floorTexture]
    : null;
  const wallTexturePath = !polyWall && ambiance?.wallFinish && ambiance.wallFinish !== "default" && ambiance.wallFinish !== "paint"
    ? WALL_TEXTURE_MAP[ambiance.wallFinish]
    : null;
  const wallColor = ambiance?.wallFinish === "paint" ? ambiance.wallColor : "#f0f0f0";

  const { floorShape, floorSize, wallMeshes } = useMemo(() => {
    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));
    const floorPts = room.points.map((p) => new THREE.Vector2(p.x / 100, -p.y / 100));
    floorPts.reverse();
    const floorShape = new THREE.Shape(floorPts);

    // Compute floor bounding size for texture scaling
    const rawPts = room.points.map((p) => ({ x: p.x / 100, y: p.y / 100 }));
    const minX = Math.min(...rawPts.map((p) => p.x));
    const maxX = Math.max(...rawPts.map((p) => p.x));
    const minY = Math.min(...rawPts.map((p) => p.y));
    const maxY = Math.max(...rawPts.map((p) => p.y));
    const floorSize: [number, number] = [maxX - minX, maxY - minY];

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

    return { floorShape, floorSize, wallMeshes };
  }, [room, doors]);

  // Global segment counter for anti-tiling
  let segCounter = 0;

  return (
    <group>
      {/* Floor */}
      {showFloor && (
        <group>
          {polyFloor?.urls?.diffuse ? (
            <Suspense fallback={null}>
              <PolyHavenSurface
                shape={floorShape}
                position={[0, 0.001, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                textureData={polyFloor}
                surfaceSize={floorSize}
              />
            </Suspense>
          ) : floorTexturePath ? (
            <TexturedFloor shape={floorShape} texturePath={floorTexturePath} surfaceSize={floorSize} />
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
          const idx = segCounter++;

          if (polyWall?.urls?.diffuse) {
            return (
              <Suspense key={`wall-${wi}-${si}`} fallback={null}>
                <PolyHavenWallSegment
                  position={pos}
                  rotation={rot}
                  size={size}
                  textureData={polyWall}
                  segmentIndex={idx}
                />
              </Suspense>
            );
          }

          if (wallTexturePath) {
            return (
              <TexturedWallSegment
                key={`wall-${wi}-${si}`}
                position={pos}
                rotation={rot}
                size={size}
                texturePath={wallTexturePath}
                segmentIndex={idx}
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
