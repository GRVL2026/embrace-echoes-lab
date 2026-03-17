import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import type { PolyHavenHDRI } from "./Viewer3DToolbar";

type Props = {
  hdri: PolyHavenHDRI | null | undefined;
  intensity?: number;
  showBackground?: boolean;
};

export function HDRIEnvironment({ hdri, intensity = 1, showBackground = false }: Props) {
  const { scene, gl } = useThree();
  const currentUrlRef = useRef<string | null>(null);
  const envMapRef = useRef<THREE.DataTexture | null>(null);

  useEffect(() => {
    if (!hdri?.url) {
      // Remove HDRI
      if (envMapRef.current) {
        scene.environment = null;
        scene.background = null;
        envMapRef.current.dispose();
        envMapRef.current = null;
        currentUrlRef.current = null;
      }
      return;
    }

    if (hdri.url === currentUrlRef.current) {
      // Same URL — just update intensity/background
      if (envMapRef.current) {
        scene.environment = envMapRef.current;
        (scene as any).environmentIntensity = intensity;
        scene.background = showBackground ? envMapRef.current : null;
      }
      return;
    }

    // Load new HDRI
    currentUrlRef.current = hdri.url;
    const loader = new RGBELoader();

    // Fetch through the proxy with auth headers, then use loader
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    fetch(hdri.url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HDRI fetch failed: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        // Check if URL is still current
        if (currentUrlRef.current !== hdri.url) return;

        // Create a blob URL so RGBELoader can load it
        const blob = new Blob([buffer], { type: "application/octet-stream" });
        const blobUrl = URL.createObjectURL(blob);

        loader.load(blobUrl, (texture) => {
          URL.revokeObjectURL(blobUrl);

          if (currentUrlRef.current !== hdri.url) {
            texture.dispose();
            return;
          }

          texture.mapping = THREE.EquirectangularReflectionMapping;

          // Dispose previous
          if (envMapRef.current) envMapRef.current.dispose();
          envMapRef.current = texture;

          scene.environment = texture;
          (scene as any).environmentIntensity = intensity;
          scene.background = showBackground ? texture : null;
        });
      })
      .catch((err) => {
        console.error("[HDRI] Failed to load:", err);
      });

    return () => {
      // Cleanup on unmount
      if (envMapRef.current) {
        scene.environment = null;
        scene.background = null;
        envMapRef.current.dispose();
        envMapRef.current = null;
      }
      currentUrlRef.current = null;
    };
  }, [hdri?.url, scene]);

  // Update intensity/background when they change (without reloading)
  useEffect(() => {
    if (envMapRef.current) {
      (scene as any).environmentIntensity = intensity;
      scene.background = showBackground ? envMapRef.current : null;
    }
  }, [intensity, showBackground, scene]);

  return null;
}
