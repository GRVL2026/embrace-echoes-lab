import type { Pillar } from "@/types/editor";

type Props = { pillar: Pillar };

export function Pillar3D({ pillar }: Props) {
  const h = (pillar.height || 280) / 100; // cm → m
  const w = pillar.width / 100;
  const d = pillar.depth / 100;
  const rotY = -(pillar.rotation || 0) * (Math.PI / 180);

  return (
    <mesh
      position={[pillar.position.x / 100, h / 2, pillar.position.y / 100]}
      rotation={[0, rotY, 0]}
      castShadow
      receiveShadow
    >
      {pillar.shape === "round" ? (
        <cylinderGeometry args={[w / 2, w / 2, h, 24]} />
      ) : (
        <boxGeometry args={[w, h, d]} />
      )}
      <meshStandardMaterial color="#2a2a3e" roughness={0.6} metalness={0.1} />
    </mesh>
  );
}
