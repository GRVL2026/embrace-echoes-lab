/**
 * Global registry to capture screenshots from the live R3F Canvas.
 * The Viewer3D registers a capture function; pdfExport calls it.
 */
import * as THREE from "three";
import type { CaptureView } from "./render3DCaptures";

type CaptureFunction = (
  views: { view: CaptureView; position: THREE.Vector3; lookAt: THREE.Vector3; showWalls: boolean; showCirculation: boolean }[]
) => Promise<Record<CaptureView, string>>;

let registeredCaptureFn: CaptureFunction | null = null;

export function registerCanvasCapture(fn: CaptureFunction) {
  registeredCaptureFn = fn;
}

export function unregisterCanvasCapture() {
  registeredCaptureFn = null;
}

export function getCanvasCaptureFn(): CaptureFunction | null {
  return registeredCaptureFn;
}
