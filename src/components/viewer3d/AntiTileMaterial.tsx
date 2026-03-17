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
  detailScale = 0.27,
  detailBlend = 0.25,
  ...props
}: Props) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailScale = { value: detailScale };
      shader.uniforms.uDetailBlend = { value: detailBlend };

      // Inject uniforms
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        uniform float uDetailScale;
        uniform float uDetailBlend;`,
      );

      // After standard map sampling, modulate with a coarser-scale sample
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          vec4 _detailTex = texture2D(map, vMapUv * uDetailScale);
          diffuseColor.rgb *= mix(vec3(1.0), _detailTex.rgb * 2.0, uDetailBlend);
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
