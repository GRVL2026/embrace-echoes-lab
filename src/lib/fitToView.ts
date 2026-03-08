import type { EditorState, Point } from "@/types/editor";

const CM_TO_PX = 0.5;

/**
 * Calculate zoom & pan to fit all plan elements in the viewport.
 * @param sidebarWidth - width of the right sidebar in px (0 if collapsed)
 */
export function fitToView(
  state: EditorState,
  sidebarWidth = 288
): { zoom: number; pan: Point } | null {
  const allPts: Point[] = [];
  state.rooms.forEach((r) => r.points.forEach((p) => allPts.push(p)));
  state.pillars.forEach((p) => {
    const half = Math.max(p.width, p.depth) / 2;
    allPts.push({ x: p.position.x - half, y: p.position.y - half });
    allPts.push({ x: p.position.x + half, y: p.position.y + half });
  });
  state.placedEquipments.forEach((e) => {
    const half = Math.max(e.width, e.depth) / 2 + e.safetyZone;
    allPts.push({ x: e.position.x - half, y: e.position.y - half });
    allPts.push({ x: e.position.x + half, y: e.position.y + half });
  });

  if (allPts.length === 0) return null;

  const minX = Math.min(...allPts.map((p) => p.x));
  const maxX = Math.max(...allPts.map((p) => p.x));
  const minY = Math.min(...allPts.map((p) => p.y));
  const maxY = Math.max(...allPts.map((p) => p.y));

  const planWidth = maxX - minX;
  const planHeight = maxY - minY;
  const paddingCm = 100;

  const toolbarWidth = 60;
  const headerHeight = 56;
  const vw = window.innerWidth - toolbarWidth - sidebarWidth;
  const vh = window.innerHeight - headerHeight;

  const zoomX = vw / ((planWidth + paddingCm * 2) * CM_TO_PX);
  const zoomY = vh / ((planHeight + paddingCm * 2) * CM_TO_PX);
  const zoom = Math.min(zoomX, zoomY, 5);

  const cx = ((minX + maxX) / 2) * CM_TO_PX;
  const cy = ((minY + maxY) / 2) * CM_TO_PX;
  const px = vw / 2 - cx * zoom + toolbarWidth;
  const py = vh / 2 - cy * zoom + headerHeight;

  return { zoom, pan: { x: px, y: py } };
}
