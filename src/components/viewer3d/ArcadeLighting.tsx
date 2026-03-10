import { useMemo } from "react";
import type { Room } from "@/types/editor";

type Props = { rooms: Room[] };

export function ArcadeLighting({ rooms }: Props) {
  // Compute center of all rooms for main light positioning
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
      {/* Main overhead — dim warm */}
      <directionalLight
        position={[center.x, 8, center.z]}
        intensity={0.3}
        color="#ffeedd"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Neon purple accent */}
      <pointLight
        position={[center.x - 3, 2.5, center.z - 2]}
        intensity={8}
        color="#9B5CFF"
        distance={12}
        decay={2}
      />

      {/* Neon cyan accent */}
      <pointLight
        position={[center.x + 3, 2.5, center.z + 2]}
        intensity={8}
        color="#00e5ff"
        distance={12}
        decay={2}
      />

      {/* Neon magenta accent */}
      <pointLight
        position={[center.x, 2.5, center.z - 3]}
        intensity={5}
        color="#ff00aa"
        distance={10}
        decay={2}
      />

      {/* Green floor wash */}
      <pointLight
        position={[center.x + 2, 0.3, center.z + 3]}
        intensity={3}
        color="#ADFF00"
        distance={8}
        decay={2}
      />
    </>
  );
}
