/**
 * Invariants de la caméra du Planner.
 * Aucune dépendance WebGL : tout est du calcul pur, vérifiable en CI.
 * Chaque check renvoie { id, ok, blocking, value, detail } — le test échoue si
 * un check `blocking` est faux, et logue les non-bloquants en avertissement.
 */
import {
  type SceneSpec, type CamSolution, type Camera, type Vec2,
  WALL_HEIGHT, CAM_WALL_MARGIN,
  obbCorners, obbFootprint, pointInPolygon, distToPolygon, polygonArea,
  crossesPolygon, project, toViewSpace, screenCoverage, cameraFrom,
} from "@/lib/plannerCamera";

export type Check = { id: string; ok: boolean; blocking: boolean; value: string; detail: string };

const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

export function checkPlannerCamera(spec: SceneSpec, sol: CamSolution): Check[] {
  const cam: Camera = cameraFrom(sol, spec.width, spec.height);
  const out: Check[] = [];
  const add = (id: string, ok: boolean, blocking: boolean, value: string, detail: string) =>
    out.push({ id, ok, blocking, value, detail });

  const camXZ: Vec2 = { x: sol.position.x, z: sol.position.z };
  const hasRoom = spec.poly.length >= 3;
  const hasMachines = spec.machines.length > 0;

  /* I0 — aucune valeur non finie (NaN/Infinity) nulle part */
  const nums = [sol.position.x, sol.position.y, sol.position.z, sol.target.x, sol.target.y, sol.target.z, sol.fov, sol.near, sol.far];
  add("I0-finite", nums.every(Number.isFinite), true, nums.map((n) => num(n)).join(" "),
    "position/cible/fov/near/far doivent être des nombres finis (un NaN vide l'image entière)");

  /* I1 — la caméra est STRICTEMENT dans le polygone de la salle, avec marge */
  if (hasRoom) {
    const inside = pointInPolygon(camXZ, spec.poly);
    const d = distToPolygon(camXZ, spec.poly);
    add("I1-camera-intra-muros", inside, true, `${inside ? "dedans" : "DEHORS"}, ${num(d)} m du mur le plus proche`,
      "les murs sont des Box opaques : une caméra hors polygone ne voit que le dos d'un mur (= aplat gris)");
    add("I1b-marge-mur", !inside || d >= CAM_WALL_MARGIN, true, `${num(d)} m ≥ ${CAM_WALL_MARGIN} m ?`,
      "le mur fait 0,12 m centré sur l'arête ; sous 0,45 m on rentre dans la géométrie du mur");
  }

  /* I2 — hauteur d'œil sous le plafond opaque et au-dessus du sol */
  add("I2-hauteur-oeil", sol.position.y >= 0.6 && sol.position.y <= WALL_HEIGHT - 0.2, true,
    `${num(sol.position.y)} m ∈ [0,60 ; ${num(WALL_HEIGHT - 0.2)}]`,
    "au-dessus du plafond (2,80 m) on filme le dessus de la dalle ; sous 0,60 m on filme le sol");

  /* I3 — cible dans la salle et regard non dégénéré */
  if (hasRoom) {
    add("I3-cible-intra-muros", pointInPolygon({ x: sol.target.x, z: sol.target.z }, spec.poly), true,
      `${num(sol.target.x)} / ${num(sol.target.z)}`, "on doit regarder DANS la salle");
  }
  const horiz = Math.hypot(sol.target.x - sol.position.x, sol.target.z - sol.position.z);
  const pitch = (Math.atan2(sol.target.y - sol.position.y, horiz) * 180) / Math.PI;
  add("I3b-axe-non-degenere", horiz > 0.5, true, `${num(horiz)} m d'écart horizontal`,
    "cible à l'aplomb de la caméra : lookAt() choisit un `up` arbitraire, l'image bascule");
  add("I3c-tangage", pitch > -45 && pitch < 15, false, `${num(pitch, 1)}°`,
    "hors de [-45°, +15°] la vue ne ressemble plus à une photo de salle");

  /* I4 — aucune machine derrière la caméra / collée à l'objectif */
  if (hasMachines) {
    let minDepth = Infinity, behind = 0;
    for (const m of spec.machines) for (const c of obbCorners(m)) {
      const d = -toViewSpace(c, cam).z;
      minDepth = Math.min(minDepth, d);
      if (d <= sol.near) behind++;
    }
    add("I4-devant-la-camera", behind === 0, true, `${behind} coin(s) derrière le near plane, min ${num(minDepth)} m`,
      "un objet derrière la caméra n'apparaît pas ; c'est le symptôme d'une caméra mal orientée");
    add("I4b-distance-mini", minDepth >= 0.8, false, `${num(minDepth)} m`,
      "sous 0,80 m une machine occulte tout le cadre");
  }

  /* I5 — cadrage : chaque machine tient dans l'image */
  if (hasMachines) {
    let centersIn = 0, cornersIn = 0, cornersTot = 0, worst = 0;
    const offenders: string[] = [];
    for (const m of spec.machines) {
      const cp = project({ x: m.x, y: m.h / 2, z: m.z }, cam);
      if (cp.depth > cam.near && Math.abs(cp.ndc.x) <= 0.98 && Math.abs(cp.ndc.y) <= 0.98) centersIn++;
      else offenders.push(m.name);
      let mw = 0;
      for (const c of obbCorners(m)) {
        const p = project(c, cam); cornersTot++;
        if (p.visible) cornersIn++;
        if (p.depth > cam.near) mw = Math.max(mw, Math.abs(p.ndc.x), Math.abs(p.ndc.y));
      }
      worst = Math.max(worst, mw);
    }
    add("I5-centres-cadres", centersIn === spec.machines.length, true,
      `${centersIn}/${spec.machines.length}` + (offenders.length ? ` — hors cadre : ${offenders.join(", ")}` : ""),
      "le centre de chaque machine doit tomber dans les 98 % centraux de l'image");
    add("I5b-coins-cadres", cornersIn / cornersTot >= 0.9, false,
      `${cornersIn}/${cornersTot} coins (${num((100 * cornersIn) / cornersTot, 0)} %)`,
      "on tolère 10 % de coins rognés (une borne peut mordre le bord)");
    add("I5c-marge-ndc", worst <= 0.98, false, `pire |NDC| = ${num(worst, 3)}`,
      "marge de sécurité avant rognage");
  }

  /* I6 — ligne de vue : aucun mur entre la caméra et une machine (salles non convexes) */
  if (hasRoom && hasMachines) {
    const blocked = spec.machines.filter((m) => crossesPolygon(camXZ, { x: m.x, z: m.z }, spec.poly)).map((m) => m.name);
    add("I6-ligne-de-vue", blocked.length === 0, true, blocked.length ? blocked.join(", ") : "aucune occultation",
      "un segment caméra→machine qui coupe une arête du polygone = machine derrière un mur (salle en L)");
  }

  /* I6b — poteaux : occultation partielle tolérée, totale non */
  if (spec.pillars.length && hasMachines) {
    const hidden = spec.machines.filter((m) => {
      const corners = obbFootprint(m);
      const nHidden = corners.filter((c) =>
        spec.pillars.some((p) => segmentHitsCircle(camXZ, c, p, p.r)),
      ).length;
      return nHidden === corners.length;
    }).map((m) => m.name);
    add("I6b-poteaux", hidden.length === 0, false, hidden.length ? hidden.join(", ") : "aucune machine masquée",
      "une machine entièrement derrière un poteau disparaît du composite");
  }

  /* I7 — couverture écran : le vrai détecteur d'« image quasi vide » */
  if (hasMachines) {
    const cov = screenCoverage(spec, cam);
    const biggest = Math.max(...cov.per.map((p) => p.frac));
    add("I7-couverture", cov.union >= 0.06, true, `${num(cov.union * 100, 1)} % de l'image`,
      "sous 6 % de pixels « machine », le composite est vide et la passe IA n'a rien à relighter");
    add("I7b-pas-de-gros-plan", biggest <= 0.55, false, `plus grosse machine : ${num(biggest * 100, 1)} %`,
      "au-delà de 55 %, une machine bouche le cadre");
    add("I7c-chacune-visible", cov.per.every((p) => p.frac >= 0.0015), false,
      cov.per.filter((p) => p.frac < 0.0015).map((p) => p.id).join(", ") || "toutes visibles",
      "une machine sous 0,15 % de l'image (≈ 2000 px) est illisible pour la passe IA");
  }

  /* I8 — cohérence de profondeur (détecte une matrice de vue miroir / inversée) */
  if (spec.machines.length >= 2) {
    const rows = spec.machines.map((m) => ({
      name: m.name,
      dist: Math.hypot(m.x - sol.position.x, m.z - sol.position.z),
      depth: -toViewSpace({ x: m.x, y: m.h / 2, z: m.z }, cam).z,
    }));
    let bad = 0;
    for (const a of rows) for (const b of rows) if (a.dist < b.dist - 0.5 && a.depth > b.depth) bad++;
    add("I8-ordre-profondeur", bad === 0, true, `${bad} inversion(s)`,
      "si une machine plus proche a une profondeur plus grande, la matrice de vue est fausse");
  }

  /* I9 — plafond : il doit épouser le polygone, pas sa bounding box */
  if (hasRoom) {
    const xs = spec.poly.map((p) => p.x), zs = spec.poly.map((p) => p.z);
    const bbox = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    const ratio = bbox / Math.max(1e-6, polygonArea(spec.poly));
    add("I9-plafond-polygone", ratio <= 1.02, false, `bbox / polygone = ${num(ratio, 3)}`,
      "le plafond actuel est un PlaneGeometry sur la bbox : il déborde des murs sur une salle en L");
  }

  return out;
}

function segmentHitsCircle(a: Vec2, b: Vec2, c: { x: number; z: number }, r: number): boolean {
  const vx = b.x - a.x, vz = b.z - a.z;
  const len2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.z - a.z) * vz) / len2));
  return Math.hypot(c.x - (a.x + t * vx), c.z - (a.z + t * vz)) < r;
}

export function formatChecks(label: string, checks: Check[]): string {
  const lines = checks.map((c) => `  ${c.ok ? "OK  " : c.blocking ? "FAIL" : "warn"} ${c.id.padEnd(22)} ${c.value}`);
  return `${label}\n${lines.join("\n")}`;
}

export function blockingFailures(checks: Check[]): Check[] {
  return checks.filter((c) => c.blocking && !c.ok);
}
