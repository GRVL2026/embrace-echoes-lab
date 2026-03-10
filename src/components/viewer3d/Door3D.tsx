import { useMemo } from "react";
import * as THREE from "three";
import type { Room, Door } from "@/types/editor";

const WALL_HEIGHT = 2.8;
const DOOR_HEIGHT = 2.1; // standard door height in meters
const DOOR_THICKNESS = 0.05;

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

    // Position along wall
    const cx = start.x + Math.cos(angle) * doorCenter;
    const cz = start.y + Math.sin(angle) * doorCenter;

    return { cx, cz, angle, doorWidthM };
  }, [door, rooms]);

  if (!mesh) return null;

  const { cx, cz, angle, doorWidthM } = mesh;
  const isMain = door.isMainDoor;

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {/* Door panel */}
      <mesh position={[0, DOOR_HEIGHT / 2, 0]} castShadow>
        <boxGeometry args={[doorWidthM, DOOR_HEIGHT, DOOR_THICKNESS]} />
        <meshStandardMaterial
          color={isMain ? "#4a90d9" : "#8B7355"}
          roughness={0.6}
          metalness={0.1}
          transparent
          opacity={0.85}
          {...({} as any)}
        />
      </mesh>

      {/* Door frame - top */}
      <mesh position={[0, DOOR_HEIGHT + 0.025, 0]}>
        <boxGeometry args={[doorWidthM + 0.06, 0.05, DOOR_THICKNESS + 0.02]} />
        <meshStandardMaterial color="#555" roughness={0.4} metalness={0.3} {...({} as any)} />
      </mesh>

      {/* Door frame - left */}
      <mesh position={[-(doorWidthM / 2 + 0.015), DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.03, DOOR_HEIGHT, DOOR_THICKNESS + 0.02]} />
        <meshStandardMaterial color="#555" roughness={0.4} metalness={0.3} {...({} as any)} />
      </mesh>

      {/* Door frame - right */}
      <mesh position={[(doorWidthM / 2 + 0.015), DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.03, DOOR_HEIGHT, DOOR_THICKNESS + 0.02]} />
        <meshStandardMaterial color="#555" roughness={0.4} metalness={0.3} {...({} as any)} />
      </mesh>
    </group>
  );
}
