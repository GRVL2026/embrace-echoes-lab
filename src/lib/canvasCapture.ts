/**
 * Captures screenshots directly from the live R3F Canvas.
 * Registered by a component inside the Canvas, called by pdfExport.
 */
import * as THREE from "three";
import type { CaptureView } from "./render3DCaptures";

export type ViewConfig = {
  view: CaptureView;
  showWalls: boolean;
  showCirculation: boolean;
};

type CaptureCallback = (configs: ViewConfig[]) => Promise<Record<string, string>>;

let _captureFn: CaptureCallback | null = null;

export function registerCanvasCapture(fn: CaptureCallback) {
  _captureFn = fn;
}

export function unregisterCanvasCapture() {
  _captureFn = null;
}

export function isCanvasCaptureAvailable(): boolean {
  return _captureFn !== null;
}

export async function captureFromLiveCanvas(): Promise<Record<CaptureView, string> | null> {
  if (!_captureFn) return null;

  const configs: ViewConfig[] = [
    { view: "top", showWalls: true, showCirculation: false },
    { view: "front", showWalls: true, showCirculation: false },
    { view: "side", showWalls: true, showCirculation: false },
    { view: "perspective", showWalls: true, showCirculation: false },
    { view: "perspectiveOpen", showWalls: false, showCirculation: false },
    { view: "perspectiveCorridor", showWalls: false, showCirculation: true },
  ];

  const result = await _captureFn(configs);
  return result as Record<CaptureView, string>;
}
