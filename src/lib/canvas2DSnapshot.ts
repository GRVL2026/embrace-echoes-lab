/**
 * Stores snapshots of the 2D canvas for PDF export.
 * Updated every time the 2D canvas re-renders.
 */
let _canvas2DSnapshot: string | null = null;
let _canvas2DMeasuredSnapshot: string | null = null;

export function setCanvas2DSnapshot(dataUrl: string) {
  _canvas2DSnapshot = dataUrl;
}

export function getCanvas2DSnapshot(): string | null {
  return _canvas2DSnapshot;
}

/** Snapshot with gap measurements drawn */
export function setCanvas2DMeasuredSnapshot(dataUrl: string) {
  _canvas2DMeasuredSnapshot = dataUrl;
}

export function getCanvas2DMeasuredSnapshot(): string | null {
  return _canvas2DMeasuredSnapshot;
}
