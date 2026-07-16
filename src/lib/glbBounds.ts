import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";

/** Shared Draco decoder (same CDN as drei's useGLTF default). */
let dracoLoader: DRACOLoader | null = null;
function getDraco() {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
  }
  return dracoLoader;
}

/** Dimensions in centimetres. GLB scenes are authored in metres. */
export type GLBDimensions = { width: number; depth: number; height: number };

/** Parse a GLB File/ArrayBuffer/URL and return its bounding-box dimensions in cm.
 *  A single Y-axis rotation (deg) can be applied before measuring so that the
 *  computed footprint matches the visible orientation of the model.
 */
export async function readGLBDimensions(
  source: File | ArrayBuffer | string,
  rotationDeg = 0,
): Promise<GLBDimensions> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDraco());

  let buffer: ArrayBuffer;
  if (source instanceof ArrayBuffer) {
    buffer = source;
  } else if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Impossible de télécharger le modèle (${res.status})`);
    buffer = await res.arrayBuffer();
  } else {
    buffer = await source.arrayBuffer();
  }

  const gltf = await new Promise<any>((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });

  const root = gltf.scene as THREE.Object3D;
  if (rotationDeg) {
    root.rotation.y = -rotationDeg * (Math.PI / 180);
    root.updateMatrixWorld(true);
  }
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  return {
    width: Math.max(1, Math.round(size.x * 100)),
    height: Math.max(1, Math.round(size.y * 100)),
    depth: Math.max(1, Math.round(size.z * 100)),
  };
}

/** True if any axis differs from the reference by more than `threshold` (0.2 = 20%). */
export function dimsDivergeSignificantly(
  model: GLBDimensions,
  ref: { width: number; depth: number; height: number },
  threshold = 0.2,
): boolean {
  const check = (a: number, b: number) => {
    if (!a || !b) return true;
    return Math.abs(a - b) / Math.max(a, b) > threshold;
  };
  return check(model.width, ref.width) || check(model.depth, ref.depth) || check(model.height, ref.height);
}
