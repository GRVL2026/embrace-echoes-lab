import { useMemo } from "react";
import * as THREE from "three";
import type { CirculationSegment, Point } from "@/types/editor";

type Props = {
  segments: CirculationSegment[];
};

/** Deduplicate points that are too close */
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

/** Chaikin smoothing */
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
  const meshData = useMemo(() => {
    if (!segments || segments.length === 0) return null;

    const corridorWidth = (segments[0]?.width || 140) / 100; // cm → m

    // Build chains from segments
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

    // Process each chain into a tube-like flat ribbon
    return chains.map((rawChain, ci) => {
      let chain = deduplicateChain(rawChain, 8);
      chain = smoothChain(chain, 1);
      chain = deduplicateChain(chain, 3);
      if (chain.length < 2) return null;

      // Convert to 3D points (cm → m, y → z)
      const curve = new THREE.CatmullRomCurve3(
        chain.map((p) => new THREE.Vector3(p.x / 100, 0.02, p.y / 100)),
        false,
        "catmullrom",
        0.5
      );

      return { curve, width: corridorWidth, key: ci };
    }).filter(Boolean) as { curve: THREE.CatmullRomCurve3; width: number; key: number }[];
  }, [segments]);

  if (!meshData || meshData.length === 0) return null;

  return (
    <group>
      {meshData.map(({ curve, width, key }) => {
        // Create a flat ribbon along the curve
        const points = curve.getPoints(Math.max(curve.points.length * 4, 40));
        const halfW = width / 2;

        // Build vertices for a flat ribbon
        const vertices: number[] = [];
        const indices: number[] = [];

        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          // Get direction
          let dir: THREE.Vector3;
          if (i < points.length - 1) {
            dir = new THREE.Vector3().subVectors(points[i + 1], p).normalize();
          } else {
            dir = new THREE.Vector3().subVectors(p, points[i - 1]).normalize();
          }
          // Perpendicular on XZ plane
          const perp = new THREE.Vector3(-dir.z, 0, dir.x);

          // Left and right points
          vertices.push(
            p.x + perp.x * halfW, p.y, p.z + perp.z * halfW,
            p.x - perp.x * halfW, p.y, p.z - perp.z * halfW
          );

          if (i < points.length - 1) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2);
            indices.push(base + 1, base + 3, base + 2);
          }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return (
          <mesh key={key} geometry={geometry} receiveShadow>
            <meshStandardMaterial
              color="hsl(142, 70%, 45%)"
              emissive="hsl(142, 70%, 35%)"
              emissiveIntensity={0.3}
              transparent
              opacity={0.45}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
