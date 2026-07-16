import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CirculationSegment, Point } from "@/types/editor";
import { segmentsToSmoothChains, buildRibbonSides } from "@/lib/circulationSpline";

type Props = {
  segments: CirculationSegment[];
};

/** Build a single indexed triangle-strip ribbon from a chain. cm → m. */
function buildRibbonGeometry(
  chain: Point[],
  halfWidthCm: number,
  yOffset: number,
): THREE.BufferGeometry | null {
  if (chain.length < 2) return null;
  const { left, right } = buildRibbonSides(chain, halfWidthCm, 2.5);
  const n = chain.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    positions[i * 6 + 0] = left[i].x / 100;
    positions[i * 6 + 1] = yOffset;
    positions[i * 6 + 2] = left[i].y / 100;
    positions[i * 6 + 3] = right[i].x / 100;
    positions[i * 6 + 4] = yOffset;
    positions[i * 6 + 5] = right[i].y / 100;
    const v = i / (n - 1);
    uvs[i * 4 + 0] = 0; uvs[i * 4 + 1] = v;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = v;
    if (i > 0) {
      const a = (i - 1) * 2, b = (i - 1) * 2 + 1, c = i * 2, d = i * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Build a rounded end cap (half disc) at position p oriented perpendicular to dir. */
function buildEndCap(p: Point, dirX: number, dirY: number, halfWidthCm: number, yOffset: number): THREE.BufferGeometry {
  const disc = new THREE.CircleGeometry(halfWidthCm / 100, 24, 0, Math.PI);
  // Rotate flat (XZ plane), then align with corridor direction.
  const angle = Math.atan2(dirY, dirX);
  const m = new THREE.Matrix4();
  m.makeRotationX(-Math.PI / 2);
  m.premultiply(new THREE.Matrix4().makeRotationY(-angle - Math.PI / 2));
  m.premultiply(new THREE.Matrix4().makeTranslation(p.x / 100, yOffset, p.y / 100));
  disc.applyMatrix4(m);
  return disc;
}

export function Circulation3D({ segments }: Props) {
  const { ribbonGeo, turningGeo, centerlineGeo } = useMemo(() => {
    if (!segments || segments.length === 0) {
      return { ribbonGeo: null, turningGeo: null, centerlineGeo: null };
    }

    const corridorCm = segments[0]?.width || 120;
    const halfCm = corridorCm / 2;
    const turningRadiusM = 140 / 100 / 2; // 0.70m

    const chains = segmentsToSmoothChains(segments, 10);
    if (chains.length === 0) {
      return { ribbonGeo: null, turningGeo: null, centerlineGeo: null };
    }

    const ribbons: THREE.BufferGeometry[] = [];
    const turningGeoms: THREE.BufferGeometry[] = [];
    const centerlineSegs: number[] = [];

    for (const chain of chains) {
      const ribbon = buildRibbonGeometry(chain, halfCm, 0.02);
      if (ribbon) ribbons.push(ribbon);

      // Rounded caps at both ends.
      const first = chain[0], second = chain[1];
      const last = chain[chain.length - 1], prev = chain[chain.length - 2];
      const dxA = first.x - second.x, dyA = first.y - second.y;
      const dxB = last.x - prev.x, dyB = last.y - prev.y;
      ribbons.push(buildEndCap(first, dxA, dyA, halfCm, 0.02));
      ribbons.push(buildEndCap(last, dxB, dyB, halfCm, 0.02));

      // Turning zone rings (1.40m) at start & end.
      for (const p of [first, last]) {
        const ring = new THREE.RingGeometry(halfCm / 100, turningRadiusM, 40);
        const m = new THREE.Matrix4();
        m.makeRotationX(-Math.PI / 2);
        m.premultiply(new THREE.Matrix4().makeTranslation(p.x / 100, 0.025, p.y / 100));
        ring.applyMatrix4(m);
        turningGeoms.push(ring);
      }

      // Dashed centerline — emit short segments (30cm on, 20cm off).
      const on = 30, off = 20; // cm
      let acc = 0;
      let drawing = true;
      let prevPt = chain[0];
      let cursor = { ...chain[0] };
      for (let i = 1; i < chain.length; i++) {
        let sx = prevPt.x, sy = prevPt.y;
        const ex = chain[i].x, ey = chain[i].y;
        let remain = Math.hypot(ex - sx, ey - sy);
        while (remain > 0) {
          const need = drawing ? on - acc : off - acc;
          const take = Math.min(need, remain);
          const t = take / remain;
          const nx = sx + (ex - sx) * t;
          const ny = sy + (ey - sy) * t;
          if (drawing) {
            centerlineSegs.push(sx / 100, 0.03, sy / 100, nx / 100, 0.03, ny / 100);
          }
          sx = nx; sy = ny;
          remain -= take;
          acc += take;
          if (acc >= (drawing ? on : off) - 0.001) {
            drawing = !drawing;
            acc = 0;
          }
        }
        prevPt = chain[i];
      }
      void cursor;
    }

    const ribbonMerged = ribbons.length > 0 ? mergeGeometries(ribbons, false) : null;
    const turningMerged = turningGeoms.length > 0 ? mergeGeometries(turningGeoms, false) : null;
    ribbons.forEach(g => g.dispose());
    turningGeoms.forEach(g => g.dispose());

    let centerlineGeo: THREE.BufferGeometry | null = null;
    if (centerlineSegs.length > 0) {
      centerlineGeo = new THREE.BufferGeometry();
      centerlineGeo.setAttribute("position", new THREE.Float32BufferAttribute(centerlineSegs, 3));
    }

    return { ribbonGeo: ribbonMerged, turningGeo: turningMerged, centerlineGeo };
  }, [segments]);

  if (!ribbonGeo && !turningGeo && !centerlineGeo) return null;

  return (
    <group>
      {ribbonGeo && (
        <mesh geometry={ribbonGeo} receiveShadow>
          <meshStandardMaterial
            color="hsl(142, 70%, 50%)"
            emissive="hsl(142, 70%, 40%)"
            emissiveIntensity={0.25}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
      {centerlineGeo && (
        <lineSegments geometry={centerlineGeo}>
          <lineBasicMaterial color="hsl(142, 80%, 75%)" transparent opacity={0.7} />
        </lineSegments>
      )}
      {turningGeo && (
        <mesh geometry={turningGeo} receiveShadow>
          <meshStandardMaterial
            color="hsl(200, 70%, 55%)"
            emissive="hsl(200, 70%, 45%)"
            emissiveIntensity={0.3}
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
