import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

type Props = {
  enabled: boolean;
  intensity: number; // 0..1
  color?: string;
};

export function SceneFog({ enabled, intensity, color = "#1a1a2e" }: Props) {
  const { scene } = useThree();

  useEffect(() => {
    if (enabled) {
      // Map intensity 0..1 to near/far: lower intensity = farther fog
      const near = 2 + (1 - intensity) * 10;
      const far = 15 + (1 - intensity) * 30;
      scene.fog = new THREE.Fog(color, near, far);
    } else {
      scene.fog = null;
    }
    return () => {
      scene.fog = null;
    };
  }, [enabled, intensity, color, scene]);

  return null;
}
