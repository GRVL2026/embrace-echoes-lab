import { useMemo } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { PlacedEquipment } from "@/types/equipment";

type Props = {
  equipment: PlacedEquipment;
};

/** Parse HSL string like "hsl(263, 85%, 68%)" to a THREE.Color */
function parseHSLColor(color: string): THREE.Color {
  const match = color.match(/hsl\(\s*([\d.]+),?\s*([\d.]+)%?,?\s*([\d.]+)%?\s*\)/);
  if (match) {
    const h = parseFloat(match[1]) / 360;
    const s = parseFloat(match[2]) / 100;
    const l = parseFloat(match[3]) / 100;
    return new THREE.Color().setHSL(h, s, l);
  }
  return new THREE.Color(color);
}

export function Equipment3D({ equipment }: Props) {
  const { w, d, h, color } = useMemo(() => {
    // cm → meters
    const w = equipment.width / 100;
    const d = equipment.depth / 100;
    // Use a reasonable height (equipment type height, default 1.2m)
    const h = 1.2;
    const color = parseHSLColor(equipment.color || "hsl(263, 85%, 68%)");
    return { w, d, h, color };
  }, [equipment]);

  const rotY = -(equipment.rotation || 0) * (Math.PI / 180);

  return (
    <group
      position={[equipment.position.x / 100, h / 2, equipment.position.y / 100]}
      rotation={[0, rotY, 0]}
    >
      {/* Main body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          roughness={0.5}
          metalness={0.1}
          emissive={color}
          emissiveIntensity={0.05}
        />
      </mesh>

      {/* Top label */}
      <Text
        position={[0, h / 2 + 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.12}
        color="#222222"
        anchorX="center"
        anchorY="middle"
        maxWidth={w * 0.9}
      >
        {equipment.name}
      </Text>

      {/* Subtle glow ring at base */}
      <mesh position={[0, -h / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(w, d) * 0.5, Math.max(w, d) * 0.55, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
    </group>
  );
}
