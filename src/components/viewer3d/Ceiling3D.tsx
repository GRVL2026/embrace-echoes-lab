import { useMemo } from "react";
import * as THREE from "three";
import type { Room } from "@/types/editor";
import type { CeilingType } from "./Viewer3DToolbar";

type Props = {
  room: Room;
  ceilingType: CeilingType;
  height?: number; // meters, default 2.8
};

export function Ceiling3D({ room, ceilingType }: Props) {
  const { shape, beamLines } = useMemo(() => {
    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, -p.y / 100));
    pts.reverse();
    const shape = new THREE.Shape(pts);

    // Calculate beams along the longest axis
    const rawPts = room.points.map((p) => ({ x: p.x / 100, z: p.y / 100 }));
    const minX = Math.min(...rawPts.map((p) => p.x));
    const maxX = Math.max(...rawPts.map((p) => p.x));
    const minZ = Math.min(...rawPts.map((p) => p.z));
    const maxZ = Math.max(...rawPts.map((p) => p.z));

    const beamLines: { x: number; z1: number; z2: number }[] = [];
    const spacing = 2.5;
    for (let x = minX + spacing; x < maxX; x += spacing) {
      beamLines.push({ x, z1: minZ, z2: maxZ });
    }

    return { shape, beamLines };
  }, [room]);

  if (ceilingType === "none") return null;

  const color = ceilingType === "black" ? "#111111" : ceilingType === "tiles" ? "#e8e8e8" : "#d4a574";
  const roughness = ceilingType === "tiles" ? 0.4 : ceilingType === "black" ? 0.9 : 0.6;

  return (
    <group>
      {/* Main ceiling plane */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CEILING_HEIGHT, 0]}>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={color}
          roughness={roughness}
          metalness={0.02}
          side={THREE.DoubleSide}
          {...({} as any)}
        />
      </mesh>

      {/* Tiles grid lines */}
      {ceilingType === "tiles" && (
        <group position={[0, CEILING_HEIGHT - 0.01, 0]}>
          {/* Simulated tile grid with thin lines - using the room bounds */}
        </group>
      )}

      {/* Exposed beams */}
      {ceilingType === "beams" &&
        beamLines.map((beam, i) => {
          const length = Math.abs(beam.z2 - beam.z1);
          const centerZ = (beam.z1 + beam.z2) / 2;
          return (
            <mesh
              key={i}
              position={[beam.x, CEILING_HEIGHT - 0.1, centerZ]}
              castShadow
            >
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
    </group>
  );
}
