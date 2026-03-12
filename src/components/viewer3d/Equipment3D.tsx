import { useMemo, Suspense, useState, useEffect } from "react";
import * as THREE from "three";
import { Text, useGLTF } from "@react-three/drei";
import { ErrorBoundary } from "./GLBErrorBoundary";
import type { PlacedEquipment } from "@/types/equipment";

type Props = {
  equipment: PlacedEquipment;
  showHeight?: boolean;
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
    
    // Deep-clone materials so textures are preserved on each instance
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(m => m.clone());
        } else if (mesh.material) {
          mesh.material = mesh.material.clone();
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    
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

export function Equipment3D({ equipment, showHeight = false }: Props) {
  const { w, d, h, color } = useMemo(() => {
    const w = equipment.width / 100;
    const d = equipment.depth / 100;
    const h = (equipment.height || 120) / 100;
    const color = parseHSLColor(equipment.color || "hsl(263, 85%, 68%)");
    return { w, d, h, color };
  }, [equipment]);

  const rotY = -(equipment.rotation || 0) * (Math.PI / 180);
  const model3dUrl = equipment.model3d;
  const heightCm = equipment.height || 120;

  return (
    <group
      position={[equipment.position.x / 100, model3dUrl ? 0 : h / 2, equipment.position.y / 100]}
      rotation={[0, rotY, 0]}
    >
      {model3dUrl ? (
        <ErrorBoundary fallback={<BoxModel w={w} d={d} h={h} color={color} />}>
          <Suspense fallback={<BoxModel w={w} d={d} h={h} color={color} />}>
            <GLBModel
              url={model3dUrl}
              width={equipment.width}
              depth={equipment.depth}
              height={equipment.height || 120}
            />
          </Suspense>
        </ErrorBoundary>
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

      {/* Height indicator */}
      {showHeight && (
        <group position={[w / 2 + 0.15, 0, 0]}>
          {/* Vertical line */}
          <mesh position={[0, (model3dUrl ? h : 0) / 2 + h / 2, 0]}>
            <boxGeometry args={[0.02, h, 0.02]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          {/* Bottom tick */}
          <mesh position={[0, model3dUrl ? 0 : 0, 0]}>
            <boxGeometry args={[0.12, 0.02, 0.02]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          {/* Top tick */}
          <mesh position={[0, h, 0]}>
            <boxGeometry args={[0.12, 0.02, 0.02]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          {/* Height label */}
          <Text
            position={[0.15, h / 2, 0]}
            fontSize={0.14}
            color="#ef4444"
            anchorX="left"
            anchorY="middle"
            fontWeight="bold"
          >
            {heightCm} cm
          </Text>
        </group>
      )}
    </group>
  );
}
