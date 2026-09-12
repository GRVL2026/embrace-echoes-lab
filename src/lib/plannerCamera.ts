/**
 * Solveur de caméra du Planner — GÉOMÉTRIE PURE, ZÉRO three.js, ZÉRO WebGL.
 *
 * Pourquoi ce fichier existe : la caméra de `renderPlannerScene()` était calculée en ligne,
 * au milieu du code qui construit la scène WebGL. Impossible à tester hors navigateur, donc
 * jamais testée, donc le bug « image quasi vide » (caméra posée 8,80 m DEHORS, derrière un mur
 * opaque) est parti en production.
 *
 * Règle : `renderPlannerScene()` ne calcule plus rien ; elle APPELLE `solvePlannerCamera()`
 * et recopie le résultat dans la PerspectiveCamera.
 *
 * Repère : le plan 2D est en cm (x droite, y bas). La scène three est en mètres avec
 *   X = x_cm / 100      Z = -y_cm / 100      Y = hauteur
 * Tout ce fichier travaille dans le repère SCÈNE (mètres), pour coller au rendu.
 */

export const WALL_HEIGHT = 3.5;
/** Marge minimale entre la caméra et l'intérieur d'un mur (le mur fait 0,12 m d'épaisseur,
 *  centré sur l'arête : sa face intérieure est déjà 0,06 m en dedans). */
export const CAM_WALL_MARGIN = 0.45;

export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

/** Emprise orientée d'une machine, en mètres, repère scène. */
export type Obb = {
  id: string;
  name: string;
  /** centre au sol */
  x: number;
  z: number;
  /** demi-largeur / demi-profondeur (m) */
  hw: number;
  hd: number;
  /** hauteur (m) */
  h: number;
  /** rotation appliquée à la scène : theta = -rotation_deg * PI / 180 */
  theta: number;
};

/** Tout ce dont le solveur (et les tests) ont besoin. Sérialisable en JSON. */
export type SceneSpec = {
  /** polygone de la salle, repère scène, sens quelconque, non répété */
  poly: Vec2[];
  /** true si la salle est fermée (sinon : pas de sol, murs incomplets) */
  closed: boolean;
  machines: Obb[];
  /** empreintes des poteaux (occulteurs) */
  pillars: { x: number; z: number; r: number }[];
  width: number;
  height: number;
};

export type CamSolution = {
  position: Vec3;
  target: Vec3;
  /** fov VERTICAL en degrés */
  fov: number;
  near: number;
  far: number;
  /** diagnostic : pourquoi cette pose */
  reason: string;
  /** true si le solveur n'a pas réussi à tout cadrer et a dû accepter un recadrage */
  degraded: boolean;
};

/* ------------------------------------------------------------------ */
/* Construction du SceneSpec depuis les types métier                    */
/* ------------------------------------------------------------------ */

type RoomLike = { points: { x: number; y: number }[]; isClosed?: boolean };
type PillarLike = { position: { x: number; y: number }; width: number; depth?: number };
type EqLike = {
  id: string;
  name?: string;
  position: { x: number; y: number };
  rotation: number;
  width: number;
  depth: number;
  height?: number;
};

export function buildSceneSpec(
  rooms: RoomLike[],
  equipments: EqLike[],
  pillars: PillarLike[] = [],
  width = 1600,
  height = 900,
): SceneSpec {
  const room = rooms.find((r) => r.points.length >= 3) ?? rooms[0];
  const poly = (room?.points ?? []).map((p) => ({ x: p.x / 100, z: -p.y / 100 }));
  return {
    poly,
    closed: room?.isClosed !== false && poly.length >= 3,
    machines: equipments.map((e, i) => ({
      id: e.id ?? `eq${i}`,
      name: e.name ?? e.id ?? `eq${i}`,
      x: e.position.x / 100,
      z: -e.position.y / 100,
      hw: Math.max(0.05, e.width / 200),
      hd: Math.max(0.05, e.depth / 200),
      h: Math.max(0.2, (e.height || 120) / 100),
      theta: -(e.rotation * Math.PI) / 180,
    })),
    pillars: pillars.map((p) => ({ x: p.position.x / 100, z: -p.position.y / 100, r: p.width / 200 })),
    width,
    height,
  };
}

/* ------------------------------------------------------------------ */
/* Primitives géométriques 2D (plan XZ)                                 */
/* ------------------------------------------------------------------ */

/** 8 coins de la boîte orientée, repère scène. Reproduit EXACTEMENT la rotation three
 *  `mesh.rotation.y = theta` appliquée à un point local (lx, ly, lz). */
export function obbCorners(o: Obb): Vec3[] {
  const c = Math.cos(o.theta), s = Math.sin(o.theta);
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1]) {
    const lx = sx * o.hw, lz = sz * o.hd;
    out.push({ x: o.x + lx * c + lz * s, y: sy * o.h, z: o.z - lx * s + lz * c });
  }
  return out;
}

/** 4 coins au sol, dans l'ordre du contour (pour tracer / tester l'occultation). */
export function obbFootprint(o: Obb): Vec2[] {
  const c = Math.cos(o.theta), s = Math.sin(o.theta);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = sx * o.hw, lz = sz * o.hd;
    return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
  });
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz));
}

export function distToPolygon(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

/** Deux segments se coupent-ils (strictement) ? */
export function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
         ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** Le segment cam→cible traverse-t-il un mur du polygone ? */
export function crossesPolygon(a: Vec2, b: Vec2, poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (segmentsCross(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  return false;
}

/** Distance depuis `o` dans la direction `d` jusqu'au premier mur (Infinity si aucun). */
export function rayToPolygon(o: Vec2, d: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    const den = d.x * ez - d.z * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - o.x) * ez - (a.z - o.z) * ex) / den;
    const u = ((a.x - o.x) * d.z - (a.z - o.z) * d.x) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Projection perspective — réimplémentation PURE de three.js           */
/* ------------------------------------------------------------------ */

export type Camera = {
  position: Vec3; target: Vec3;
  /** fov VERTICAL en degrés (identique à THREE.PerspectiveCamera.fov) */
  fov: number; aspect: number; near: number; far: number;
  /** taille du rendu, pour convertir NDC → pixels */
  W: number; H: number;
};

export function cameraFrom(sol: CamSolution, W: number, H: number): Camera {
  return { position: sol.position, target: sol.target, fov: sol.fov, aspect: W / H, near: sol.near, far: sol.far, W, H };
}

export type Projected = {
  /** NDC : x,y ∈ [-1,1] visible ; z ∈ [-1,1] entre near et far */
  ndc: Vec3;
  /** pixels, origine coin haut-gauche */
  px: number; py: number;
  /** profondeur caméra en mètres (= -z_vue) ; négative = DERRIÈRE la caméra */
  depth: number;
  visible: boolean;
};

/** Matrice de vue = inverse de la matrice monde construite par THREE.Object3D.lookAt().
 *  three : zAxis = normalize(eye - target) ; xAxis = normalize(up × zAxis) ; yAxis = zAxis × xAxis.
 *  Si eye et target sont colinéaires à `up`, three décale `up` — on refuse ce cas (assert). */
export function viewBasis(cam: Camera) {
  const up = { x: 0, y: 1, z: 0 };
  let zx = cam.position.x - cam.target.x, zy = cam.position.y - cam.target.y, zz = cam.position.z - cam.target.z;
  const zl = Math.hypot(zx, zy, zz);
  if (zl < 1e-9) throw new Error("caméra et cible confondues");
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
  const xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-6) throw new Error("direction de vue parallèle à l'axe vertical (up dégénéré)");
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return { x: { x: xx, y: xy, z: xz }, y: { x: yx, y: yy, z: yz }, z: { x: zx, y: zy, z: zz } };
}

/** Coordonnées dans l'espace caméra (three : on regarde vers -Z). */
export function toViewSpace(p: Vec3, cam: Camera): Vec3 {
  const b = viewBasis(cam);
  const dx = p.x - cam.position.x, dy = p.y - cam.position.y, dz = p.z - cam.position.z;
  return {
    x: dx * b.x.x + dy * b.x.y + dz * b.x.z,
    y: dx * b.y.x + dy * b.y.y + dz * b.y.z,
    z: dx * b.z.x + dy * b.z.y + dz * b.z.z,
  };
}

/**
 * Projection perspective identique à THREE.PerspectiveCamera (sans `filmOffset`, `zoom`=1,
 * `view`=null). Matrice de three (makePerspective, convention OpenGL, depth [-1,1]) :
 *   m00 = 2n/(r-l)   m02 = (r+l)/(r-l)
 *   m11 = 2n/(t-b)   m12 = (t+b)/(t-b)
 *   m22 = -(f+n)/(f-n)   m23 = -2fn/(f-n)   m32 = -1
 * avec t = n·tan(fov/2), b = -t, r = t·aspect, l = -r → m02 = m12 = 0,
 *   m00 = 1/(tan(fov/2)·aspect),  m11 = 1/tan(fov/2).
 */
export function project(p: Vec3, cam: Camera): Projected {
  const v = toViewSpace(p, cam);
  const t = Math.tan((cam.fov * Math.PI) / 360);
  const m00 = 1 / (t * cam.aspect), m11 = 1 / t;
  const n = cam.near, f = cam.far;
  const clipX = m00 * v.x, clipY = m11 * v.y;
  const clipZ = (-(f + n) / (f - n)) * v.z + (-2 * f * n) / (f - n);
  const w = -v.z;
  const ndc = { x: clipX / w, y: clipY / w, z: clipZ / w };
  return {
    ndc,
    px: ((ndc.x + 1) / 2) * cam.W,
    py: ((1 - ndc.y) / 2) * cam.H,
    depth: w,
    visible: w > n && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1,
  };
}

/* ------------------------------------------------------------------ */
/* Solveur LEGACY — copie fidèle du code actuel de renderPlannerScene   */
/* Sert UNIQUEMENT de témoin de non-régression (il doit ÉCHOUER).       */
/* ------------------------------------------------------------------ */

export function solvePlannerCameraLegacy(spec: SceneSpec): CamSolution {
  const P = spec.machines.map((m) => ({ x: m.x, z: m.z, h: m.h }));
  const rp = spec.poly;
  if (!P.length) {
    const cx = rp.reduce((s, p) => s + p.x, 0) / (rp.length || 1);
    const cz = rp.reduce((s, p) => s + p.z, 0) / (rp.length || 1);
    return {
      position: { x: cx, y: 6, z: cz + 8 }, target: { x: cx, y: 1.2, z: cz },
      fov: 50, near: 0.1, far: 500, reason: "legacy-fallback", degraded: true,
    };
  }
  const xs = P.map((p) => p.x), zs = P.map((p) => p.z);
  const mnx = Math.min(...xs), mxx = Math.max(...xs), mnz = Math.min(...zs), mxz = Math.max(...zs);
  const maxh = Math.max(...P.map((p) => p.h), 1.2);
  const cxm = (mnx + mxx) / 2, czm = (mnz + mxz) / 2;
  const R = 0.5 * Math.hypot(mxx - mnx, mxz - mnz, maxh) + 1.0;
  const rcx = rp.reduce((s, p) => s + p.x, 0) / (rp.length || 1);
  const rcz = rp.reduce((s, p) => s + p.z, 0) / (rp.length || 1);
  const dx = cxm - rcx, dz = czm - rcz, l = Math.hypot(dx, dz);
  let dirx: number, dirz: number;
  if (l > 0.5) { dirx = -dx / l; dirz = -dz / l; }
  else if (mxx - mnx >= mxz - mnz) { dirx = 0; dirz = -1; }
  else { dirx = -1; dirz = 0; }
  const fov = (50 * Math.PI) / 180;
  const dist = Math.max(3, (R / Math.sin(fov / 2)) * 1.1);
  return {
    position: { x: cxm + dirx * dist, y: 1.85, z: czm + dirz * dist },
    target: { x: cxm, y: Math.min(1.2, maxh * 0.55), z: czm },
    fov: 50, near: 0.1, far: 500, reason: "legacy", degraded: false,
  };
}

/* ------------------------------------------------------------------ */
/* Couverture écran : fraction de l'image occupée par les machines      */
/* ------------------------------------------------------------------ */

/** Rasterise les silhouettes (enveloppe convexe des 8 coins projetés) sur une grille
 *  grossière et renvoie la fraction de l'image couverte, plus la couverture par machine. */
export function screenCoverage(spec: SceneSpec, cam: Camera, gx = 160, gy = 90) {
  const grid = new Uint8Array(gx * gy);
  const per: { id: string; frac: number }[] = [];
  for (const m of spec.machines) {
    const pts = obbCorners(m).map((c) => project(c, cam)).filter((p) => p.depth > cam.near);
    if (pts.length < 3) { per.push({ id: m.id, frac: 0 }); continue; }
    const hull = convexHull(pts.map((p) => ({ x: p.px, z: p.py })));
    let own = 0;
    const minX = Math.max(0, Math.floor((Math.min(...hull.map((h) => h.x)) / cam.W) * gx));
    const maxX = Math.min(gx - 1, Math.ceil((Math.max(...hull.map((h) => h.x)) / cam.W) * gx));
    const minY = Math.max(0, Math.floor((Math.min(...hull.map((h) => h.z)) / cam.H) * gy));
    const maxY = Math.min(gy - 1, Math.ceil((Math.max(...hull.map((h) => h.z)) / cam.H) * gy));
    for (let j = minY; j <= maxY; j++) for (let i = minX; i <= maxX; i++) {
      const p = { x: ((i + 0.5) / gx) * cam.W, z: ((j + 0.5) / gy) * cam.H };
      if (pointInPolygon(p, hull)) { grid[j * gx + i] = 1; own++; }
    }
    per.push({ id: m.id, frac: own / (gx * gy) });
  }
  let union = 0;
  for (let i = 0; i < grid.length; i++) union += grid[i];
  return { union: union / (gx * gy), per };
}

export function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => (a.x - b.x) || (a.z - b.z));
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/* ------------------------------------------------------------------ */
/* Solveur corrigé : on CHERCHE une pose valide À L'INTÉRIEUR de la salle */
/* ------------------------------------------------------------------ */

const EYE_HEIGHTS = [1.55, 1.85, 2.2, 2.5];
const FOV_LADDER = [45, 50, 55, 60, 65, 72, 80, 88];
const MIN_DEPTH = 0.8;      // m : rien ne colle à l'objectif
const NDC_MARGIN = 0.92;    // 4 % de marge sur chaque bord


/** Boîte écran (NDC clippée) de chaque machine + fraction d'image occupée.
 *  Sert au score de LISIBILITÉ : une machine vue en enfilade a une aire minuscule. */
function machineBoxes(spec: SceneSpec, cam: Camera) {
  return spec.machines.map((m) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of obbCorners(m)) {
      const p = project(c, cam);
      x0 = Math.min(x0, p.ndc.x); x1 = Math.max(x1, p.ndc.x);
      y0 = Math.min(y0, p.ndc.y); y1 = Math.max(y1, p.ndc.y);
    }
    const cx0 = Math.max(-1, x0), cx1 = Math.min(1, x1);
    const cy0 = Math.max(-1, y0), cy1 = Math.min(1, y1);
    const w = Math.max(0, cx1 - cx0), h = Math.max(0, cy1 - cy0);
    return { x0: cx0, y0: cy0, x1: cx1, y1: cy1, frac: (w * h) / 4 };
  });
}

/** Score de lisibilité d'une pose : la PLUS PETITE machine doit rester lisible,
 *  et les machines ne doivent pas se masquer entre elles. Remplace le score
 *  « remplissage » qui collait la caméra dans un coin, rangée vue en enfilade. */
function readability(spec: SceneSpec, cam: Camera): number {
  const b = machineBoxes(spec, cam);
  if (!b.length) return 0;
  const minFrac = Math.min(...b.map((x) => x.frac));
  const sum = b.reduce((s, x) => s + x.frac, 0) || 1e-9;
  let inter = 0;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const w = Math.max(0, Math.min(b[i].x1, b[j].x1) - Math.max(b[i].x0, b[j].x0));
    const h = Math.max(0, Math.min(b[i].y1, b[j].y1) - Math.max(b[i].y0, b[j].y0));
    inter += (w * h) / 4;
  }
  const overlap = Math.min(1, inter / sum);
  const fovPenalty = 1 - 0.15 * ((cam.fov - 45) / 43);   // léger bonus aux focales longues
  return minFrac * (1 - 0.6 * overlap) * Math.max(0.5, fovPenalty);
}

export function solvePlannerCamera(spec: SceneSpec): CamSolution {
  const poly = spec.poly;
  const near = 0.1, far = 500;
  const centroid = poly.length
    ? { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length }
    : { x: 0, z: 0 };

  if (!spec.machines.length || poly.length < 3) {
    const d = poly.length ? Math.max(2, distToPolygon(centroid, poly) - CAM_WALL_MARGIN) : 6;
    return {
      position: { x: centroid.x, y: 1.85, z: centroid.z + d },
      target: { x: centroid.x, y: 1.2, z: centroid.z },
      fov: 55, near, far, reason: "salle vide ou polygone absent", degraded: !spec.machines.length,
    };
  }

  const corners = spec.machines.flatMap(obbCorners);
  const mnx = Math.min(...spec.machines.map((m) => m.x)), mxx = Math.max(...spec.machines.map((m) => m.x));
  const mnz = Math.min(...spec.machines.map((m) => m.z)), mxz = Math.max(...spec.machines.map((m) => m.z));
  const maxh = Math.max(...spec.machines.map((m) => m.h), 1.2);
  const target = { x: (mnx + mxx) / 2, y: Math.min(1.2, maxh * 0.6), z: (mnz + mxz) / 2 };

  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  // grille de poses candidates strictement intra-muros
  const step = Math.max(0.2, Math.min(x1 - x0, z1 - z0) / 24);
  const spots: Vec2[] = [];
  for (let x = x0 + step / 2; x <= x1; x += step) for (let z = z0 + step / 2; z <= z1; z += step) {
    const p = { x, z };
    if (!pointInPolygon(p, poly)) continue;
    if (distToPolygon(p, poly) < CAM_WALL_MARGIN) continue;
    if (spec.machines.some((m) => pointInPolygon(p, obbFootprint(m)) || Math.hypot(p.x - m.x, p.z - m.z) < Math.hypot(m.hw, m.hd) + 0.35)) continue;
    if (spec.pillars.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 0.35)) continue;
    spots.push(p);
  }
  if (!spots.length) spots.push(centroid);

  // ---- PASSE 1 : VUE DE FACE (la plus simple à lire, demandée en priorité) ----
  // On regarde la rangée perpendiculairement, depuis le mur opposé, centré sur elle :
  // axe de vue aligné sur X ou Z, aucune obliquité. On ne bascule sur la recherche
  // libre que si aucune pose frontale ne cadre tout.
  {
    const cx = (mnx + mxx) / 2, cz = (mnz + mxz) / 2;
    const sides: { x: number; z: number; axis: "x" | "z" }[] = [];
    // Centré sur la rangée, puis décalages le long du mur : si l'aplomb exact est
    // occupé (îlot au milieu, poteau), on glisse latéralement plutôt que d'abandonner
    // la vue de face. Les décalages sont testés du plus petit au plus grand.
    const OFF = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.6, -2.6, 3.2, -3.2];
    for (const o of OFF) {
      sides.push({ x: cx + o, z: z0, axis: "z" });
      sides.push({ x: cx + o, z: z1, axis: "z" });
      sides.push({ x: x0, z: cz + o, axis: "x" });
      sides.push({ x: x1, z: cz + o, axis: "x" });
    }
    const frontSpots: (Vec2 & { axis: "x" | "z" })[] = [];
    for (const sp of sides) {
      let p = { x: sp.x, z: sp.z };
      // rentrer dans la salle avec la marge de mur, en reculant vers le centre
      for (let k = 0; k < 40 && (!pointInPolygon(p, poly) || distToPolygon(p, poly) < CAM_WALL_MARGIN); k++) {
        p = { x: p.x + (centroid.x - p.x) * 0.06, z: p.z + (centroid.z - p.z) * 0.06 };
      }
      if (!pointInPolygon(p, poly) || distToPolygon(p, poly) < CAM_WALL_MARGIN) continue;
      if (spec.machines.some((m) => pointInPolygon(p, obbFootprint(m)) || Math.hypot(p.x - m.x, p.z - m.z) < Math.hypot(m.hw, m.hd) + 0.35)) continue;
      if (spec.pillars.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 0.35)) continue;
      frontSpots.push({ ...p, axis: sp.axis });
    }
    let bf: (CamSolution & { score: number }) | null = null;
    for (const fov of FOV_LADDER) {
      for (const spot of frontSpots) for (const eye of EYE_HEIGHTS) {
        // visée STRICTEMENT perpendiculaire au mur : la salle se lit de face, sans biais
        const tgt = spot.axis === "z"
          ? { x: spot.x, y: target.y, z: cz }
          : { x: cx, y: target.y, z: spot.z };
        const cam: Camera = { position: { x: spot.x, y: eye, z: spot.z }, target: tgt, fov, aspect: spec.width / spec.height, near, far, W: spec.width, H: spec.height };
        if (Math.hypot(cam.position.x - tgt.x, cam.position.z - tgt.z) < 0.5) continue;
        let worst = 0, minDepth = Infinity;
        for (const c of corners) { const pr = project(c, cam); worst = Math.max(worst, Math.abs(pr.ndc.x), Math.abs(pr.ndc.y)); minDepth = Math.min(minDepth, pr.depth); }
        if (minDepth < MIN_DEPTH || worst > NDC_MARGIN) continue;
        if (spec.machines.some((m) => crossesPolygon(spot, { x: m.x, z: m.z }, poly))) continue;
        const score = readability(spec, cam);
        if (!bf || score > bf.score) {
          bf = { position: cam.position, target: tgt, fov, near, far, reason: `vue de face, fov ${fov}°, lisibilité ${score.toFixed(4)}`, degraded: false, score };
        }
      }
      if (bf) break; // focale la plus longue qui marche de face
    }
    if (bf) { const { score: _s, ...sol } = bf; return sol; }
  }

  let best: (CamSolution & { score: number }) | null = null;
  for (const fov of FOV_LADDER) {
    for (const spot of spots) for (const eye of EYE_HEIGHTS) {
      const cam: Camera = { position: { x: spot.x, y: eye, z: spot.z }, target, fov, aspect: spec.width / spec.height, near, far, W: spec.width, H: spec.height };
      if (Math.hypot(cam.position.x - target.x, cam.position.z - target.z) < 0.5) continue; // up dégénéré
      let worst = 0, minDepth = Infinity;
      for (const c of corners) { const p = project(c, cam); worst = Math.max(worst, Math.abs(p.ndc.x), Math.abs(p.ndc.y)); minDepth = Math.min(minDepth, p.depth); }
      if (minDepth < MIN_DEPTH || worst > NDC_MARGIN) continue;
      if (spec.machines.some((m) => crossesPolygon(spot, { x: m.x, z: m.z }, poly))) continue; // mur entre la caméra et une machine
      // score = remplissage du cadre (pire |NDC| le plus proche possible de la marge) ;
      // volontairement PAS la couverture rasterisée, trop coûteuse dans la boucle.
      const score = readability(spec, cam);
      if (!best || score > best.score) {
        best = { position: cam.position, target, fov, near, far, reason: `fov ${fov}°, lisibilité ${score.toFixed(4)}`, degraded: false, score };
      }
    }
  }
  if (best) { const { score: _s, ...sol } = best; return sol; }

  // Dégradé : impossible de tout cadrer (salle trop petite / machines trop étalées).
  // On maximise le nombre de machines entièrement visibles au fov le plus large.
  const fov = FOV_LADDER[FOV_LADDER.length - 1];
  let fallback: CamSolution | null = null, bestCount = -1, fbScore = -1;
  for (const spot of spots) for (const eye of EYE_HEIGHTS) {
    const cam: Camera = { position: { x: spot.x, y: eye, z: spot.z }, target, fov, aspect: spec.width / spec.height, near, far, W: spec.width, H: spec.height };
    if (Math.hypot(cam.position.x - target.x, cam.position.z - target.z) < 0.5) continue;
    let n = 0;
    for (const m of spec.machines) {
      const ok = obbCorners(m).every((c) => { const p = project(c, cam); return p.depth > MIN_DEPTH && Math.abs(p.ndc.x) <= 1 && Math.abs(p.ndc.y) <= 1; });
      if (ok && !crossesPolygon(spot, { x: m.x, z: m.z }, poly)) n++;
    }
    const r = readability(spec, cam);
    if (n > bestCount || (n === bestCount && r > fbScore)) {
      bestCount = n; fbScore = r;
      fallback = { position: cam.position, target, fov, near, far, reason: `DÉGRADÉ : ${n}/${spec.machines.length} machines cadrées`, degraded: true };
    }
  }
  return fallback ?? { position: { x: centroid.x, y: 1.85, z: centroid.z }, target, fov, near, far, reason: "aucune pose", degraded: true };
}
