import { useMemo } from "react";
import type { Room } from "@/types/editor";

type Props = { rooms: Room[] };

export function ArcadeLighting({ rooms }: Props) {
  const center = useMemo(() => {
    const pts = rooms.flatMap((r) => r.points);
    if (!pts.length) return { x: 0, z: 0 };
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length / 100,
      z: pts.reduce((s, p) => s + p.y, 0) / pts.length / 100,
    };
  }, [rooms]);

  return (
    <>
      {/* Bright ambient */}
      <ambientLight intensity={0.6} color="#ffffff" />

      {/* Main sun-like directional */}
      <directionalLight
        position={[center.x + 5, 10, center.z + 5]}
        intensity={1.2}
        color="#fffaf0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Fill light from opposite side */}
      <directionalLight
        position={[center.x - 4, 6, center.z - 4]}
        intensity={0.4}
        color="#e8f0ff"
      />

      {/* Soft hemisphere for natural sky/ground bounce */}
      <hemisphereLight
        args={["#b0d4ff", "#e8e0d0", 0.5]}
      />
    </>
  );
}
