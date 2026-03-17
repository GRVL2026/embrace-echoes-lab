import { useRef, useEffect } from "react";
import * as THREE from "three";

type Props = {
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  color?: string;
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  clearcoat?: number;
  clearcoatRoughness?: number;
  reflectivity?: number;
  /** Scale factor for the detail pass (default 0.27 ≈ ~3.7× zoom out) */
  detailScale?: number;
  /** Blend strength of the detail pass (default 0.25) */
  detailBlend?: number;
  [key: string]: any;
};

/**
 * A MeshStandardMaterial enhanced with multi-scale detail blending.
 * Samples the diffuse map at a second, coarser UV scale and blends
 * it with the primary sample to break up visible tiling patterns.
 */
export function AntiTileMaterial({
  map,
  normalMap,
  roughnessMap,
  detailScale = 0.31,
  detailBlend = 0.15,
  ...props
}: Props) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailScale = { value: detailScale };
      shader.uniforms.uDetailBlend = { value: detailBlend };

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        uniform float uDetailScale;
        uniform float uDetailBlend;`,
      );

      // Luminance-based modulation: convert the coarse sample to grayscale
      // to avoid moiré / crosshatch artefacts on directional textures (wood, planks…)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          vec4 _dt = texture2D(map, vMapUv * uDetailScale);
          float _lum = dot(_dt.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(_lum * 1.8 + 0.1), uDetailBlend);
        #endif`,
      );
    };
    mat.needsUpdate = true;
  }, [detailScale, detailBlend]);

  return (
    <meshStandardMaterial
      ref={matRef}
      map={map ?? undefined}
      normalMap={normalMap ?? undefined}
      roughnessMap={roughnessMap ?? undefined}
      {...props}
    />
  );
}
