// Composite navigateur d'une vue de salle : salle en perspective + machines à l'échelle.
// Port JS de tools/planner-render/rendu.py (projection sténopé + algorithme du peintre).
// Le PNG produit est envoyé à l'edge `generer-vue` pour la passe photoréaliste (Krea).
//
// v1 : billboard — chaque machine est posée depuis sa photo de fiche (catalog images[0],
// déjà détourée), mise à l'échelle par sa HAUTEUR réelle (garantit l'échelle verticale).
// Les sprites bakés multi-angles viendront affiner (choix de l'angle) en v2.

import type { PlacedEquipment, GameEquipment } from "@/types/equipment";
import type { Room } from "@/types/editor";

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; };

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

export type CompositeResult = { dataUrl: string; count: number; withImages: number };

/** Construit le composite (dataURL PNG) à partir du plan + du catalogue. */
export async function buildComposite(
  rooms: Room[],
  placed: PlacedEquipment[],
  catalog: GameEquipment[],
  W = 1600,
  H = 900,
): Promise<CompositeResult> {
  // Bounding box de la salle (cm), repli sur les machines si pas de salle tracée.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) for (const p of r.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) {
    for (const e of placed) {
      minX = Math.min(minX, e.position.x); minY = Math.min(minY, e.position.y);
      maxX = Math.max(maxX, e.position.x); maxY = Math.max(maxY, e.position.y);
    }
    minX -= 200; minY -= 200; maxX += 200; maxY += 200;
  }
  const LX = Math.max(100, maxX - minX), LY = Math.max(100, maxY - minY), LZ = 350;

  // Caméra dans un coin (hauteur des yeux 1,70 m), visant vers le fond à 1,35 m. HFOV 68°.
  const HFOV = (68 * Math.PI) / 180;
  const FPX = (W / 2) / Math.tan(HFOV / 2);

  // Points des machines (coords monde, origine décalée) + hauteur réelle.
  const pts = placed.map((e) => {
    const cat = catalog.find((c) => c.id === e.equipmentId);
    return { e, cat, wx: e.position.x - minX, wy: e.position.y - minY, hcm: e.height || cat?.height || 150 };
  });

  // Cadrage auto : caméra DEVANT les machines, centrée sur elles, reculée jusqu'à TOUT contenir.
  let mnx = 0, mxx = LX, mny = 0, mxy = LY;
  if (pts.length) {
    mnx = Math.min(...pts.map((p) => p.wx)); mxx = Math.max(...pts.map((p) => p.wx));
    mny = Math.min(...pts.map((p) => p.wy)); mxy = Math.max(...pts.map((p) => p.wy));
  }
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  const spanX = Math.max(200, mxx - mnx);

  let CAM: V3 = [0, 0, 0], right: V3 = [1, 0, 0], up: V3 = [0, 0, 1], fwd: V3 = [0, 1, 0];
  const setCam = (dist: number) => {
    CAM = [cx - spanX * 0.15, mny - dist, 190];      // léger angle avant-gauche, un peu en hauteur
    const TGT: V3 = [cx, cy, 110];
    fwd = norm(sub(TGT, CAM)); right = norm(cross(fwd, [0, 0, 1])); up = cross(right, fwd);
  };
  const project = (P: V3): { x: number; y: number } | null => {
    const v = sub(P, CAM); const zc = dot(v, fwd);
    if (zc <= 1) return null;
    return { x: W / 2 + FPX * dot(v, right) / zc, y: H / 2 - FPX * dot(v, up) / zc };
  };
  // Recule progressivement jusqu'à ce que toutes les machines (base + sommet) tiennent dans le cadre.
  let dist = spanX / (2 * Math.tan(HFOV / 2)) + 250;
  for (let k = 0; k < 8; k++) {
    setCam(dist);
    const mx = W * 0.04, my = H * 0.04;
    const ok = pts.every((p) => {
      const b = project([p.wx, p.wy, 0]); const t = project([p.wx, p.wy, p.hcm]);
      return b && t && b.x > mx && b.x < W - mx && t.y > my && b.y < H - my;
    });
    if (ok || pts.length === 0) break;
    dist *= 1.15;
  }
  setCam(dist);

  // Machines triées du plus loin au plus proche (algorithme du peintre).
  const items = pts
    .map((o) => ({ ...o, d: Math.hypot(o.wx - CAM[0], o.wy - CAM[1]) }))
    .sort((a, b) => b.d - a.d);

  // Pré-chargement des images (une seule fois par URL).
  const urls = Array.from(new Set(items.map((o) => o.cat?.images?.[0]).filter(Boolean) as string[]));
  const imgs = new Map<string, HTMLImageElement | null>();
  await Promise.all(urls.map(async (u) => imgs.set(u, await loadImage(u))));

  let withImages = 0;
  const draw = (useImages: boolean): string => {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#8f8d8a"; ctx.fillRect(0, 0, W, H);                 // mur/fond
    const floor = ([[0, 0, 0], [LX, 0, 0], [LX, LY, 0], [0, LY, 0]] as V3[]).map(project);
    if (floor.every(Boolean)) {                                          // sol en perspective
      ctx.fillStyle = "#9c9a97"; ctx.beginPath();
      floor.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
      ctx.closePath(); ctx.fill();
    }
    for (const { e, cat, wx, wy, hcm } of items) {
      const base = project([wx, wy, 0]); const top = project([wx, wy, hcm]);
      if (!base || !top) continue;
      const ph = base.y - top.y; if (ph <= 2) continue;
      // ombre de contact
      ctx.save(); ctx.filter = "blur(5px)"; ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.beginPath(); ctx.ellipse(base.x, base.y, ph * 0.30, ph * 0.06, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      const url = cat?.images?.[0];
      const img = useImages && url ? imgs.get(url) : null;
      if (img) {
        const pw = ph * (img.width / img.height);
        ctx.drawImage(img, base.x - pw / 2, base.y - ph, pw, ph);
        withImages++;
      } else {
        const wcm = e.width || cat?.width || 80;
        const wl = project([wx - wcm / 2, wy, hcm]), wr = project([wx + wcm / 2, wy, hcm]);
        const pw = wl && wr ? Math.abs(wr.x - wl.x) : ph * 0.5;
        ctx.fillStyle = e.color || "#6b7280";
        ctx.fillRect(base.x - pw / 2, base.y - ph, pw, ph);
      }
    }
    return cv.toDataURL("image/jpeg", 0.9); // JPEG : ~5× plus léger que le PNG pour l'envoi à l'edge
  };

  try {
    const dataUrl = draw(true);
    return { dataUrl, count: items.length, withImages };
  } catch {
    // Image cross-origin qui « tache » le canvas → repli sans photos (boîtes).
    withImages = 0;
    return { dataUrl: draw(false), count: items.length, withImages: 0 };
  }
}
