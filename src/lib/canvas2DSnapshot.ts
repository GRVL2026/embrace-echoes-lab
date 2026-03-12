/**
 * Stores a snapshot of the 2D canvas for PDF export.
 * Updated every time the 2D canvas re-renders.
 */
let _canvas2DSnapshot: string | null = null;

export function setCanvas2DSnapshot(dataUrl: string) {
  _canvas2DSnapshot = dataUrl;
}

export function getCanvas2DSnapshot(): string | null {
  return _canvas2DSnapshot;
}
