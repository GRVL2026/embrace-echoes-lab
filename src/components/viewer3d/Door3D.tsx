import { useMemo } from "react";
import * as THREE from "three";
import type { Room, Door } from "@/types/editor";

const DOOR_HEIGHT = 2.1;
const DOOR_THICKNESS = 0.08;
const FRAME_SIZE = 0.06;

type Props = {
  door: Door;
  rooms: Room[];
};

export function Door3D({ door, rooms }: Props) {
  const mesh = useMemo(() => {
    const room = rooms.find((r) => r.id === door.roomId);
    if (!room) return null;

    const pts = room.points.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));
    const i = door.edgeIndex;
    const next = (i + 1) % pts.length;
    if (i >= pts.length) return null;

    const start = pts[i];
    const end = pts[next];
    const dx = end.x - start.x;
    const dz = end.y - start.y;
    const wallLength = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    const doorWidthM = door.width / 100;
    const doorCenter = door.positionRatio * wallLength;

    const cx = start.x + Math.cos(angle) * doorCenter;
    const cz = start.y + Math.sin(angle) * doorCenter;

    return { cx, cz, angle, doorWidthM };
  }, [door, rooms]);

  if (!mesh) return null;

  const { cx, cz, angle, doorWidthM } = mesh;
  const isMain = door.isMainDoor;
  const panelColor = isMain ? "#3B82F6" : "#A0522D";
  const frameColor = isMain ? "#1E40AF" : "#4A4A4A";

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {/* Door panel */}
      <mesh position={[0, DOOR_HEIGHT / 2, 0]} castShadow>
        <boxGeometry args={[doorWidthM - 0.04, DOOR_HEIGHT - 0.04, DOOR_THICKNESS]} />
        <meshStandardMaterial
          color={panelColor}
          roughness={0.5}
          metalness={0.15}
          emissive={panelColor}
          emissiveIntensity={0.15}
          {...({} as any)}
        />
      </mesh>

      {/* Door frame - top */}
      <mesh position={[0, DOOR_HEIGHT + FRAME_SIZE / 2, 0]}>
        <boxGeometry args={[doorWidthM + FRAME_SIZE, FRAME_SIZE, 0.16]} />
        <meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.4} {...({} as any)} />
      </mesh>

      {/* Door frame - left */}
      <mesh position={[-(doorWidthM / 2 + FRAME_SIZE / 2), DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[FRAME_SIZE, DOOR_HEIGHT + FRAME_SIZE, 0.16]} />
        <meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.4} {...({} as any)} />
      </mesh>

      {/* Door frame - right */}
      <mesh position={[(doorWidthM / 2 + FRAME_SIZE / 2), DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[FRAME_SIZE, DOOR_HEIGHT + FRAME_SIZE, 0.16]} />
        <meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.4} {...({} as any)} />
      </mesh>

      {/* Floor threshold marker - bright strip */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[doorWidthM + 0.2, 0.4]} />
        <meshStandardMaterial
          color={isMain ? "#60A5FA" : "#D97706"}
          emissive={isMain ? "#3B82F6" : "#D97706"}
          emissiveIntensity={0.4}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          {...({} as any)}
        />
      </mesh>
    </group>
  );
}
