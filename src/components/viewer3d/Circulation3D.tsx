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

/** Single segment rendered as a flat box on the ground */
function SegmentQuad({ start, end, width }: { start: THREE.Vector3; end: THREE.Vector3; width: number }) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 0.01) return null;

  const cx = (start.x + end.x) / 2;
  const cz = (start.z + end.z) / 2;
  const angle = Math.atan2(dz, dx);

  return (
    <mesh position={[cx, 0.02, cz]} rotation={[-Math.PI / 2, 0, -angle]} receiveShadow>
      <planeGeometry args={[length, width]} />
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

/** Circle joint at each waypoint to fill gaps between segments */
function JointDisc({ position, radius }: { position: THREE.Vector3; radius: number }) {
  return (
    <mesh position={[position.x, 0.02, position.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[radius, 16]} />
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

export function Circulation3D({ segments }: Props) {
  const renderData = useMemo(() => {
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

    // Process chains into segment pairs + joint points
    const quads: { start: THREE.Vector3; end: THREE.Vector3 }[] = [];
    const joints: THREE.Vector3[] = [];

    for (const rawChain of chains) {
      let chain = deduplicateChain(rawChain, 8);
      chain = smoothChain(chain, 1);
      chain = deduplicateChain(chain, 3);
      if (chain.length < 2) continue;

      for (let i = 0; i < chain.length - 1; i++) {
        const s = new THREE.Vector3(chain[i].x / 100, 0, chain[i].y / 100);
        const e = new THREE.Vector3(chain[i + 1].x / 100, 0, chain[i + 1].y / 100);
        quads.push({ start: s, end: e });

        // Add joint at each interior point
        if (i > 0) {
          joints.push(s);
        }
      }
      // Also add joints at start and end
      joints.push(new THREE.Vector3(chain[0].x / 100, 0, chain[0].y / 100));
      joints.push(new THREE.Vector3(chain[chain.length - 1].x / 100, 0, chain[chain.length - 1].y / 100));
    }

    return { quads, joints, corridorWidth };
  }, [segments]);

  if (!renderData) return null;

  const { quads, joints, corridorWidth } = renderData;

  return (
    <group>
      {quads.map((q, i) => (
        <SegmentQuad key={`seg-${i}`} start={q.start} end={q.end} width={corridorWidth} />
      ))}
      {joints.map((j, i) => (
        <JointDisc key={`joint-${i}`} position={j} radius={corridorWidth / 2} />
      ))}
    </group>
  );
}
