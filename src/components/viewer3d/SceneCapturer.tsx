/**
 * R3F component that registers a capture function allowing
 * the PDF export to take screenshots directly from the live 3D scene.
 * This ensures PDF captures are pixel-identical to the editor view.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { registerCanvasCapture, unregisterCanvasCapture, type ViewConfig } from "@/lib/canvasCapture";
import type { CaptureView } from "@/lib/render3DCaptures";

function getCameraPosition(
  view: CaptureView,
  cx: number,
  cz: number
): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  switch (view) {
    case "top":
      return { position: new THREE.Vector3(cx, 25, cz), lookAt: new THREE.Vector3(cx, 0, cz) };
    case "front":
      return { position: new THREE.Vector3(cx, 3, cz + 18), lookAt: new THREE.Vector3(cx, 1.2, cz) };
    case "side":
      return { position: new THREE.Vector3(cx + 18, 3, cz), lookAt: new THREE.Vector3(cx, 1.2, cz) };
    case "perspective":
    case "perspectiveOpen":
    case "perspectiveCorridor":
    default:
      return { position: new THREE.Vector3(cx + 8, 6, cz + 8), lookAt: new THREE.Vector3(cx, 1.2, cz) };
  }
}

type Props = {
  cx: number;
  cz: number;
  wallObjects: React.RefObject<THREE.Group | null>;
  circulationObjects: React.RefObject<THREE.Group | null>;
  gridObjects: React.RefObject<THREE.Group | null>;
};

export function SceneCapturer({ cx, cz, wallObjects, circulationObjects, gridObjects }: Props) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    const captureFn = async (configs: ViewConfig[]): Promise<Record<string, string>> => {
      const result: Record<string, string> = {};

      // Save original state
      const origPos = camera.position.clone();
      const origQuat = camera.quaternion.clone();
      const wallsVis = wallObjects.current?.visible ?? true;
      const circVis = circulationObjects.current?.visible ?? true;
      const gridVis = gridObjects.current?.visible ?? true;

      // Hide grid during all captures
      if (gridObjects.current) gridObjects.current.visible = false;

      for (const config of configs) {
        // Set visibility
        if (wallObjects.current) wallObjects.current.visible = config.showWalls;
        if (circulationObjects.current) circulationObjects.current.visible = config.showCirculation;

        // Move camera
        const cam = getCameraPosition(config.view, cx, cz);
        camera.position.copy(cam.position);
        camera.lookAt(cam.lookAt);
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

        // Render and capture
        gl.render(scene, camera);
        result[config.view] = gl.domElement.toDataURL("image/png");
      }

      // Restore everything
      if (wallObjects.current) wallObjects.current.visible = wallsVis;
      if (circulationObjects.current) circulationObjects.current.visible = circVis;
      if (gridObjects.current) gridObjects.current.visible = gridVis;
      camera.position.copy(origPos);
      camera.quaternion.copy(origQuat);
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      gl.render(scene, camera);

      return result;
    };

    registerCanvasCapture(captureFn);
    return () => unregisterCanvasCapture();
  }, [gl, scene, camera, cx, cz, wallObjects, circulationObjects, gridObjects]);

  return null;
}
