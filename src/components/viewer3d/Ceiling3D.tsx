import { useMemo, Suspense } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import type { Room } from "@/types/editor";
import type { CeilingType, PolyHavenTexture } from "./Viewer3DToolbar";

type Props = {
  room: Room;
  ceilingType: CeilingType;
  height?: number; // meters, default 2.8
  polyhavenTexture?: PolyHavenTexture | null;
};

/** Textured ceiling panel for technical ceiling */
function TechnicalCeilingPanel({ shape, height }: { shape: THREE.Shape; height: number }) {
  const texture = useLoader(THREE.TextureLoader, "/textures/ceiling_technical.jpg");
  const tex = useMemo(() => {
    const t = texture.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.3, 0.3);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [texture]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        map={tex}
        color="#888888"
        roughness={0.85}
        metalness={0.15}
        side={THREE.DoubleSide}
        {...({} as any)}
      />
    </mesh>
  );
}

/** Poly Haven PBR ceiling panel */
function PolyHavenCeilingPanel({ shape, height, textureData }: { shape: THREE.Shape; height: number; textureData: PolyHavenTexture }) {
  const urls = textureData.urls;
  const diffuseTex = useLoader(THREE.TextureLoader, urls.diffuse || "");
  const normalTex = urls.normal ? useLoader(THREE.TextureLoader, urls.normal) : null;
  const roughTex = urls.roughness ? useLoader(THREE.TextureLoader, urls.roughness) : null;

  const mats = useMemo(() => {
    const configure = (t: THREE.Texture) => {
      const c = t.clone();
      c.wrapS = THREE.RepeatWrapping;
      c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(0.3, 0.3);
      c.colorSpace = THREE.SRGBColorSpace;
      c.needsUpdate = true;
      return c;
    };
    return {
      diffuse: configure(diffuseTex),
      normal: normalTex ? configure(normalTex) : null,
      roughness: roughTex ? configure(roughTex) : null,
    };
  }, [diffuseTex, normalTex, roughTex]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        map={mats.diffuse}
        normalMap={mats.normal ?? undefined}
        roughnessMap={mats.roughness ?? undefined}
        roughness={mats.roughness ? 1 : 0.6}
        metalness={0.02}
        side={THREE.DoubleSide}
        {...({} as any)}
      />
    </mesh>
  );
}

export function Ceiling3D({ room, ceilingType, height = 2.8, polyhavenTexture }: Props) {
  const { shape, beamLines, ducts } = useMemo(() => {
    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, -p.y / 100));
    pts.reverse();
    const shape = new THREE.Shape(pts);

    const rawPts = room.points.map((p) => ({ x: p.x / 100, z: p.y / 100 }));
    const minX = Math.min(...rawPts.map((p) => p.x));
    const maxX = Math.max(...rawPts.map((p) => p.x));
    const minZ = Math.min(...rawPts.map((p) => p.z));
    const maxZ = Math.max(...rawPts.map((p) => p.z));
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    // Beams for "beams" type
    const beamLines: { x: number; z1: number; z2: number }[] = [];
    const spacing = 2.5;
    for (let x = minX + spacing; x < maxX; x += spacing) {
      beamLines.push({ x, z1: minZ, z2: maxZ });
    }

    // Ducts/pipes for "technical" type
    type Duct = {
      type: "main" | "branch" | "pipe" | "tray";
      pos: [number, number, number];
      size: [number, number, number];
      rotation?: [number, number, number];
    };
    const ducts: Duct[] = [];

    // Main ventilation duct running along longest axis
    if (spanX >= spanZ) {
      const mainZ = (minZ + maxZ) / 2;
      ducts.push({
        type: "main",
        pos: [(minX + maxX) / 2, 0, mainZ],
        size: [spanX * 0.85, 0.3, 0.4],
      });
      // Branch ducts perpendicular
      for (let x = minX + 2; x < maxX - 1; x += 3.5) {
        ducts.push({
          type: "branch",
          pos: [x, 0.05, mainZ + 1.2],
          size: [0.2, 0.2, 2.0],
        });
        ducts.push({
          type: "branch",
          pos: [x, 0.05, mainZ - 1.2],
          size: [0.2, 0.2, 2.0],
        });
      }
    } else {
      const mainX = (minX + maxX) / 2;
      ducts.push({
        type: "main",
        pos: [mainX, 0, (minZ + maxZ) / 2],
        size: [0.4, 0.3, spanZ * 0.85],
      });
      for (let z = minZ + 2; z < maxZ - 1; z += 3.5) {
        ducts.push({
          type: "branch",
          pos: [mainX + 1.2, 0.05, z],
          size: [2.0, 0.2, 0.2],
        });
        ducts.push({
          type: "branch",
          pos: [mainX - 1.2, 0.05, z],
          size: [2.0, 0.2, 0.2],
        });
      }
    }

    // Cable trays running parallel to walls
    ducts.push({
      type: "tray",
      pos: [minX + 0.6, 0.1, (minZ + maxZ) / 2],
      size: [0.3, 0.06, spanZ * 0.8],
    });
    ducts.push({
      type: "tray",
      pos: [maxX - 0.6, 0.1, (minZ + maxZ) / 2],
      size: [0.3, 0.06, spanZ * 0.8],
    });

    // Small pipes
    for (let x = minX + 1.5; x < maxX; x += 4) {
      ducts.push({
        type: "pipe",
        pos: [x, 0.02, minZ + 0.8],
        size: [0.06, 0.06, spanZ * 0.6],
      });
    }

    return { shape, beamLines, ducts };
  }, [room]);

  if (ceilingType === "none" && !polyhavenTexture) return null;

  const isTechnical = ceilingType === "technical";
  const color = isTechnical
    ? "#1a1a1a"
    : ceilingType === "black"
    ? "#111111"
    : ceilingType === "tiles"
    ? "#e8e8e8"
    : "#d4a574";
  const roughness = ceilingType === "tiles" ? 0.4 : ceilingType === "black" || isTechnical ? 0.9 : 0.6;

  const ductColors: Record<string, string> = {
    main: "#3a3a3a",
    branch: "#4a4a4a",
    pipe: "#555555",
    tray: "#606060",
  };

  return (
    <group>
      {/* Main ceiling plane */}
      {isTechnical ? (
        <TechnicalCeilingPanel shape={shape} height={height} />
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}>
          <shapeGeometry args={[shape]} />
          <meshStandardMaterial
            color={color}
            roughness={roughness}
            metalness={0.02}
            side={THREE.DoubleSide}
            {...({} as any)}
          />
        </mesh>
      )}

      {/* Tiles grid lines */}
      {ceilingType === "tiles" && (
        <group position={[0, height - 0.01, 0]} />
      )}

      {/* Exposed beams */}
      {ceilingType === "beams" &&
        beamLines.map((beam, i) => {
          const length = Math.abs(beam.z2 - beam.z1);
          const centerZ = (beam.z1 + beam.z2) / 2;
          return (
            <mesh key={i} position={[beam.x, height - 0.1, centerZ]} castShadow>
              <boxGeometry args={[0.15, 0.2, length]} />
              <meshStandardMaterial
                color="#8B6914"
                roughness={0.8}
                metalness={0.02}
                {...({} as any)}
              />
            </mesh>
          );
        })}

      {/* Technical ducts, pipes, cable trays */}
      {isTechnical &&
        ducts.map((duct, i) => {
          const isPipe = duct.type === "pipe";
          return (
            <mesh
              key={`duct-${i}`}
              position={[duct.pos[0], height - 0.15 - duct.pos[1], duct.pos[2]]}
              rotation={duct.rotation ?? [0, 0, 0]}
              castShadow
            >
              {isPipe ? (
                <cylinderGeometry args={[duct.size[0], duct.size[0], duct.size[2], 8]} />
              ) : (
                <boxGeometry args={duct.size} />
              )}
              <meshStandardMaterial
                color={ductColors[duct.type]}
                roughness={duct.type === "tray" ? 0.5 : 0.7}
                metalness={duct.type === "tray" ? 0.4 : 0.25}
                {...({} as any)}
              />
            </mesh>
          );
        })}
    </group>
  );
}
