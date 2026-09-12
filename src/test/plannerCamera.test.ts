/**
 * Harnais caméra du Planner — preuve sans navigateur ni WebGL.
 *
 *   npm test -- plannerCamera            # lance les invariants
 *   PLANNER_DUMP=1 npm test -- plannerCamera && python3 scripts/planner_camera_viz.py
 *                                        # + images de contrôle dans artifacts/planner-camera/
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import fs from "node:fs";
import path from "node:path";
import {
  buildSceneSpec, cameraFrom, obbCorners, project, toViewSpace,
  solvePlannerCamera, solvePlannerCameraLegacy, screenCoverage,
} from "@/lib/plannerCamera";
import { FIXTURES, fixtureRooms, fixtureEquipments, fixturePillars } from "./fixtures/plannerFixtures";
import { checkPlannerCamera, blockingFailures, formatChecks } from "./harness/plannerInvariants";

const W = 1600, H = 900;
const specOf = (f: (typeof FIXTURES)[number]) =>
  buildSceneSpec(fixtureRooms(f), fixtureEquipments(f), fixturePillars(f), W, H);

/* ================================================================== */
/* 1. La projection pure est-elle VRAIMENT celle de three.js ?          */
/*    Sans ça, tout le reste n'est qu'une approximation.                */
/* ================================================================== */
describe("projection : parité stricte avec THREE.PerspectiveCamera", () => {
  it("reproduit project() de three à 1e-9 près sur 500 points aléatoires", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let worst = 0;
    for (let trial = 0; trial < 25; trial++) {
      const fov = 35 + rnd() * 45;
      const pos = { x: rnd() * 20 - 10, y: 0.5 + rnd() * 3, z: rnd() * 20 - 10 };
      const tgt = { x: rnd() * 20 - 10, y: rnd() * 2, z: rnd() * 20 - 10 };
      if (Math.hypot(tgt.x - pos.x, tgt.z - pos.z) < 0.5) continue;
      const cam = { position: pos, target: tgt, fov, aspect: W / H, near: 0.1, far: 500, W, H };
      const t3 = new THREE.PerspectiveCamera(fov, W / H, 0.1, 500);
      t3.position.set(pos.x, pos.y, pos.z);
      t3.lookAt(new THREE.Vector3(tgt.x, tgt.y, tgt.z));
      t3.updateMatrixWorld(true);
      t3.updateProjectionMatrix();
      for (let k = 0; k < 20; k++) {
        const p = { x: rnd() * 20 - 10, y: rnd() * 3, z: rnd() * 20 - 10 };
        const mine = project(p, cam).ndc;
        const theirs = new THREE.Vector3(p.x, p.y, p.z).project(t3);
        worst = Math.max(worst, Math.abs(mine.x - theirs.x), Math.abs(mine.y - theirs.y), Math.abs(mine.z - theirs.z));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("la profondeur pure est celle de matrixWorldInverse", () => {
    const cam = { position: { x: 2, y: 1.85, z: 3 }, target: { x: -1, y: 1, z: -4 }, fov: 50, aspect: W / H, near: 0.1, far: 500, W, H };
    const t3 = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
    t3.position.set(2, 1.85, 3);
    t3.lookAt(new THREE.Vector3(-1, 1, -4));
    t3.updateMatrixWorld(true);
    const p = new THREE.Vector3(0, 1, 0);
    const theirs = p.clone().applyMatrix4(t3.matrixWorldInverse);
    const mine = toViewSpace({ x: 0, y: 1, z: 0 }, cam);
    expect(Math.abs(mine.z - theirs.z)).toBeLessThan(1e-9);
  });
});

/* ================================================================== */
/* 2. Témoin de non-régression : le solveur ACTUEL doit échouer         */
/*    (si ce test devient vert, quelqu'un a remis l'ancienne formule)   */
/* ================================================================== */
describe("solveur legacy (code actuel) — témoin du bug", () => {
  const f = FIXTURES.find((x) => x.key === "wall-row-real")!;
  const spec = specOf(f);
  const sol = solvePlannerCameraLegacy(spec);
  const checks = checkPlannerCamera(spec, sol);

  it("place la caméra HORS de la salle (cause racine de l'image vide)", () => {
    const c = checks.find((x) => x.id === "I1-camera-intra-muros")!;
    expect(c.ok, formatChecks("legacy / cas réel", checks)).toBe(false);
  });

  it("le test de frustum SEUL ne détecte rien : il faut l'invariant intra-muros", () => {
    // 48 coins sur 48 tombent dans le cadre alors que l'image finale est vide.
    const cam = cameraFrom(sol, W, H);
    const all = spec.machines.flatMap(obbCorners);
    const inFrame = all.filter((c) => project(c, cam).visible).length;
    expect(inFrame).toBe(all.length);
  });
});

/* ================================================================== */
/* 3. Le solveur corrigé respecte tous les invariants bloquants         */
/* ================================================================== */
describe("solvePlannerCamera — invariants", () => {
  for (const f of FIXTURES) {
    it(`${f.key} — ${f.label}`, () => {
      const spec = specOf(f);
      const sol = solvePlannerCamera(spec);
      const checks = checkPlannerCamera(spec, sol);
      const fails = blockingFailures(checks).filter((c) =>
        // sur un plan déclaré incadrable, le cadrage complet n'est pas exigé
        f.expectAllFramed ? true : !["I5-centres-cadres", "I6-ligne-de-vue", "I7-couverture"].includes(c.id),
      );
      expect(fails.map((c) => c.id), formatChecks(`${f.key} / ${sol.reason}`, checks)).toEqual([]);
      // « dégradé » = le solveur a renoncé à tout cadrer. Une salle vide n'a rien à cadrer :
      // l'assertion ne porte que sur les plans qui contiennent des machines.
      if (f.expectAllFramed && f.equipments.length) {
        expect(sol.degraded, formatChecks(f.key, checks)).toBe(false);
      }
    });
  }

  it("est déterministe et indépendant de l'ordre des machines", () => {
    const f = FIXTURES.find((x) => x.key === "wall-row-real")!;
    const a = solvePlannerCamera(specOf(f));
    const shuffled = { ...f, equipments: [...f.equipments].reverse() };
    const b = solvePlannerCamera(specOf(shuffled));
    expect(a.position.x).toBeCloseTo(b.position.x, 9);
    expect(a.position.z).toBeCloseTo(b.position.z, 9);
    expect(a.fov).toBe(b.fov);
  });

  it("ne renvoie jamais NaN, même sur un plan corrompu", () => {
    const f = FIXTURES.find((x) => x.key === "no-room")!;
    const sol = solvePlannerCamera(specOf(f));
    for (const v of [sol.position.x, sol.position.y, sol.position.z, sol.target.x, sol.target.y, sol.target.z, sol.fov]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

/* ================================================================== */
/* 4. Export JSON pour la visualisation Python                          */
/* ================================================================== */
describe("dump", () => {
  it("écrit artifacts/planner-camera/cases.json quand PLANNER_DUMP=1", () => {
    if (!process.env.PLANNER_DUMP) return;
    const dir = path.resolve(process.cwd(), "artifacts/planner-camera");
    fs.mkdirSync(dir, { recursive: true });
    const cases = FIXTURES.flatMap((f) => {
      const spec = specOf(f);
      return (["legacy", "fixed"] as const).map((variant) => {
        const sol = variant === "legacy" ? solvePlannerCameraLegacy(spec) : solvePlannerCamera(spec);
        const cam = cameraFrom(sol, W, H);
        const checks = checkPlannerCamera(spec, sol);
        return {
          key: `${f.key}--${variant}`, label: `${f.label} [${variant}]`, variant,
          poly: spec.poly, machines: spec.machines, pillars: spec.pillars,
          camera: { ...sol, aspect: W / H, W, H },
          coverage: spec.machines.length ? screenCoverage(spec, cam).union : 0,
          projected: spec.machines.map((m) => ({
            id: m.id, name: m.name,
            corners: obbCorners(m).map((c) => {
              const p = project(c, cam);
              return { px: p.px, py: p.py, depth: p.depth, visible: p.visible };
            }),
          })),
          checks,
        };
      });
    });
    fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify({ W, H, cases }, null, 1));
    expect(fs.existsSync(path.join(dir, "cases.json"))).toBe(true);
  });
});
