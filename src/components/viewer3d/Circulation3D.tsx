import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CirculationSegment, Point } from "@/types/editor";

type Props = {
  segments: CirculationSegment[];
};

function deduplicateChain(chain: Point[], minDist: number): Point[] {
  if (chain.length < 2) return chain;
  const result = [chain[0]];
  for (let i = 1; i < chain.length; i++) {
    const prev = result[result.length - 1];
    const dx = chain[i].x - prev.x;
    const dy = chain[i].y - prev.y;
    if (Math.sqrt(dx * dx + dy * dy) >= minDist) {
      result.push(chain[i]);
    }
  }
  return result;
}

function smoothChain(chain: Point[], iterations: number): Point[] {
  let pts = chain;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push({
        x: pts[i].x * 0.75 + pts[i + 1].x * 0.25,
        y: pts[i].y * 0.75 + pts[i + 1].y * 0.25,
      });
      next.push({
        x: pts[i].x * 0.25 + pts[i + 1].x * 0.75,
        y: pts[i].y * 0.25 + pts[i + 1].y * 0.75,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

export function Circulation3D({ segments }: Props) {
  const geometry = useMemo(() => {
    if (!segments || segments.length === 0) return null;

    const corridorWidth = (segments[0]?.width || 140) / 100;
    const halfW = corridorWidth / 2;

    const chains: Point[][] = [];
    let currentChain: Point[] = [];

    for (const seg of segments) {
      if (currentChain.length === 0) {
        currentChain.push(seg.start, seg.end);
      } else {
        const last = currentChain[currentChain.length - 1];
        const dist = Math.sqrt(
          (last.x - seg.start.x) ** 2 + (last.y - seg.start.y) ** 2
        );
        if (dist < 30) {
          currentChain.push(seg.end);
        } else {
          chains.push(currentChain);
          currentChain = [seg.start, seg.end];
        }
      }
    }
    if (currentChain.length > 0) chains.push(currentChain);

    const geometries: THREE.BufferGeometry[] = [];

    for (const rawChain of chains) {
      let chain = deduplicateChain(rawChain, 8);
      chain = smoothChain(chain, 1);
      chain = deduplicateChain(chain, 3);
      if (chain.length < 2) continue;

      // Convert to 3D (cm → m)
      const pts3 = chain.map((p) => new THREE.Vector3(p.x / 100, 0, p.y / 100));

      // For each segment, create a plane
      for (let i = 0; i < pts3.length - 1; i++) {
        const s = pts3[i];
        const e = pts3[i + 1];
        const dx = e.x - s.x;
        const dz = e.z - s.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.01) continue;

        const plane = new THREE.PlaneGeometry(len, corridorWidth);
        const cx = (s.x + e.x) / 2;
        const cz = (s.z + e.z) / 2;
        const angle = Math.atan2(dz, dx);

        const mat = new THREE.Matrix4();
        mat.makeRotationX(-Math.PI / 2);
        mat.premultiply(new THREE.Matrix4().makeRotationY(-angle));
        mat.premultiply(new THREE.Matrix4().makeTranslation(cx, 0.02, cz));
        plane.applyMatrix4(mat);
        geometries.push(plane);
      }

      // Disc joints at each point
      for (const p of pts3) {
        const disc = new THREE.CircleGeometry(halfW, 16);
        const mat = new THREE.Matrix4();
        mat.makeRotationX(-Math.PI / 2);
        mat.premultiply(new THREE.Matrix4().makeTranslation(p.x, 0.02, p.z));
        disc.applyMatrix4(mat);
        geometries.push(disc);
      }
    }

    if (geometries.length === 0) return null;

    const merged = mergeGeometries(geometries, false);
    // Dispose source geometries
    geometries.forEach((g) => g.dispose());
    return merged;
  }, [segments]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="hsl(142, 70%, 50%)"
        emissive="hsl(142, 70%, 40%)"
        emissiveIntensity={0.2}
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
