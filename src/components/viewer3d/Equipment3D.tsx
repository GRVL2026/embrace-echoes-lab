import { useMemo, Suspense, useState, useEffect } from "react";
import * as THREE from "three";
import { Text, useGLTF } from "@react-three/drei";
import { ErrorBoundary } from "./GLBErrorBoundary";
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

/** Renders a loaded .glb model scaled to fit equipment dimensions */
function GLBModel({ url, width, depth, height }: { url: string; width: number; depth: number; height: number }) {
  const { scene } = useGLTF(url);
  
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    
    const targetW = width / 100;
    const targetD = depth / 100;
    const targetH = height / 100;
    
    const scaleX = size.x > 0 ? targetW / size.x : 1;
    const scaleY = size.y > 0 ? targetH / size.y : 1;
    const scaleZ = size.z > 0 ? targetD / size.z : 1;
    const scale = Math.min(scaleX, scaleY, scaleZ);
    
    clone.scale.setScalar(scale);
    
    const newBox = new THREE.Box3().setFromObject(clone);
    const center = newBox.getCenter(new THREE.Vector3());
    clone.position.sub(center);
    clone.position.y += newBox.getSize(new THREE.Vector3()).y / 2;
    
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    return clone;
  }, [scene, width, depth, height]);

  return <primitive object={clonedScene} />;
}

/** Fallback box geometry */
function BoxModel({ w, d, h, color }: { w: number; d: number; h: number; color: THREE.Color }) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial
        color={color}
        roughness={0.5}
        metalness={0.1}
        emissive={color}
        emissiveIntensity={0.05}
        {...{} as any}
      />
    </mesh>
  );
}

export function Equipment3D({ equipment }: Props) {
  const { w, d, h, color } = useMemo(() => {
    const w = equipment.width / 100;
    const d = equipment.depth / 100;
    const h = (equipment.height || 120) / 100;
    const color = parseHSLColor(equipment.color || "hsl(263, 85%, 68%)");
    return { w, d, h, color };
  }, [equipment]);

  const rotY = -(equipment.rotation || 0) * (Math.PI / 180);
  const model3dUrl = equipment.model3d;

  return (
    <group
      position={[equipment.position.x / 100, model3dUrl ? 0 : h / 2, equipment.position.y / 100]}
      rotation={[0, rotY, 0]}
    >
      {model3dUrl ? (
        <Suspense fallback={<BoxModel w={w} d={d} h={h} color={color} />}>
          <GLBModel
            url={model3dUrl}
            width={equipment.width}
            depth={equipment.depth}
            height={equipment.height || 120}
          />
        </Suspense>
      ) : (
        <BoxModel w={w} d={d} h={h} color={color} />
      )}

      {/* Top label */}
      <Text
        position={[0, h + 0.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.12}
        color="#222222"
        anchorX="center"
        anchorY="middle"
        maxWidth={w * 0.9}
      >
        {equipment.name}
      </Text>
    </group>
  );
}
