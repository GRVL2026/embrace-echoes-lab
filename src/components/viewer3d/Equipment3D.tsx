import { useMemo, Suspense, useState, useEffect } from "react";
import * as THREE from "three";
import { Text, useGLTF } from "@react-three/drei";
import { ErrorBoundary } from "./GLBErrorBoundary";
import type { PlacedEquipment } from "@/types/equipment";

type Props = {
  equipment: PlacedEquipment;
  showHeight?: boolean;
  /** Room floor dimensions in cm, used to scale autoScale models proportionally */
  roomExtent?: { width: number; depth: number };
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
function GLBModel({ url, width, depth, height, autoScale, roomExtent }: { url: string; width: number; depth: number; height: number; autoScale?: boolean; roomExtent?: { width: number; depth: number } }) {
  // Enable Draco decoder (gstatic CDN) so Draco-compressed .glb models load correctly.
  const { scene } = useGLTF(url, true);
  
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    
    // Deep-clone materials and ensure textures have correct color space
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const fixMaterial = (m: THREE.Material) => {
          const mat = m.clone();
          const std = mat as THREE.MeshStandardMaterial;
          if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
          if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          if (std.aoMap) std.aoMap.colorSpace = THREE.SRGBColorSpace;
          return mat;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(fixMaterial);
        } else if (mesh.material) {
          mesh.material = fixMaterial(mesh.material);
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());

    if (autoScale) {
      // Scale model proportionally to the room size
      // Target: largest model dimension ≈ 15% of the room's smallest floor dimension
      const roomMinCm = roomExtent
        ? Math.min(roomExtent.width, roomExtent.depth)
        : 500; // fallback 5m
      const targetSize = (roomMinCm / 100) * 0.15; // in meters (scene units)
      const modelMax = Math.max(size.x, size.y, size.z);
      if (modelMax > 0) {
        const s = targetSize / modelMax;
        clone.scale.setScalar(s);
      }
      const scaledBox = new THREE.Box3().setFromObject(clone);
      const center = scaledBox.getCenter(new THREE.Vector3());
      clone.position.sub(center);
      clone.position.y += scaledBox.getSize(new THREE.Vector3()).y / 2;
    } else {
      const targetW = width / 100;
      const targetD = depth / 100;
      const targetH = height / 100;

      // Scale uniformly based on the horizontal footprint (width × depth).
      // The model's horizontal axes might be swapped vs the equipment, so we
      // pick the best match between (scaleX,scaleZ) and (scaleZ,scaleX) and
      // average the two factors to fill the footprint robustly.
      // Height is intentionally ignored as a scaling driver because catalog
      // heights are frequently inaccurate and would otherwise shrink models.
      const sx = size.x > 0 ? targetW / size.x : 1;
      const sz = size.z > 0 ? targetD / size.z : 1;
      const sxSwap = size.x > 0 ? targetD / size.x : 1;
      const szSwap = size.z > 0 ? targetW / size.z : 1;
      const avg = (sx + sz) / 2;
      const avgSwap = (sxSwap + szSwap) / 2;
      // Choose the orientation whose average factor is closer to the geometric
      // mean of the two — i.e. the most "balanced" fit (less distortion).
      const score = Math.abs(Math.log(sx) - Math.log(sz));
      const scoreSwap = Math.abs(Math.log(sxSwap) - Math.log(szSwap));
      let scale = scoreSwap < score ? avgSwap : avg;

      // Safety clamp: if the resulting height would be wildly off (>3× target
      // or <1/3×), nudge the scale toward the height target to avoid extremes.
      if (size.y > 0) {
        const projectedH = size.y * scale;
        if (projectedH > targetH * 3) scale = (targetH * 3) / size.y;
        else if (projectedH < targetH / 3) scale = (targetH / 3) / size.y;
      }

      clone.scale.setScalar(scale);

      const newBox = new THREE.Box3().setFromObject(clone);
      const center = newBox.getCenter(new THREE.Vector3());
      clone.position.sub(center);
      clone.position.y += newBox.getSize(new THREE.Vector3()).y / 2;
    }
    
    return clone;
  }, [scene, width, depth, height, autoScale, roomExtent]);

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

export function Equipment3D({ equipment, showHeight = false, roomExtent }: Props) {
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
              autoScale={equipment.autoScale}
              roomExtent={roomExtent}
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

      {/* Height indicator — wall-style dimension panel behind the equipment */}
      {showHeight && (
        <group position={[0, 0, -d / 2 - 0.02]}>
          {/* Semi-transparent backdrop panel */}
          <mesh position={[0, h / 2, 0]}>
            <planeGeometry args={[w * 0.35, h]} />
            <meshBasicMaterial color="#1e293b" transparent opacity={0.55} side={THREE.DoubleSide} />
          </mesh>
          {/* Top horizontal line */}
          <mesh position={[0, h, 0]}>
            <planeGeometry args={[w * 0.5, 0.015]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
          {/* Bottom horizontal line */}
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[w * 0.5, 0.015]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
          {/* Vertical line */}
          <mesh position={[0, h / 2, 0]}>
            <planeGeometry args={[0.01, h]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.7} side={THREE.DoubleSide} />
          </mesh>
          {/* Height label */}
          <Text
            position={[0, h / 2, 0.01]}
            fontSize={0.1}
            color="#ffffff"
            anchorX="center"
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
