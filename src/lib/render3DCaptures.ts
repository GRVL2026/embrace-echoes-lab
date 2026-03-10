/**
 * Offscreen Three.js renderer to capture 6 views:
 * top, front, side, perspective, perspectiveOpen (no walls), perspectiveCorridor
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Room, Door, Pillar, CirculationSegment, Point } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";

const WALL_HEIGHT = 2.8;
const CANVAS_SIZE = 1200;

export type CaptureView = "top" | "front" | "side" | "perspective" | "perspectiveOpen" | "perspectiveCorridor";

type BuildOptions = {
  showWalls?: boolean;
  showCirculation?: boolean;
};

function buildCirculationGeometry(segments: CirculationSegment[]): THREE.BufferGeometry | null {
  if (!segments || segments.length === 0) return null;

  const corridorWidth = (segments[0]?.width || 140) / 100;
  const halfW = corridorWidth / 2;

  const chains: Point[][] = [];
  let currentChain: Point[] = [];

  for (const seg of segments) {
    if (currentChain.length === 0) {
      currentChain.push(seg.start, seg.end);
    } else {
      const last = currentChain[currentChain.length - 1];
      const dist = Math.sqrt((last.x - seg.start.x) ** 2 + (last.y - seg.start.y) ** 2);
      if (dist < 30) {
        currentChain.push(seg.end);
      } else {
        chains.push(currentChain);
        currentChain = [seg.start, seg.end];
      }
    }
  }
  if (currentChain.length > 0) chains.push(currentChain);

  const geometries: THREE.BufferGeometry[] = [];

  for (const chain of chains) {
    if (chain.length < 2) continue;
    const pts3 = chain.map((p) => new THREE.Vector3(p.x / 100, 0, -p.y / 100));

    for (let i = 0; i < pts3.length - 1; i++) {
      const s = pts3[i], e = pts3[i + 1];
      const dx = e.x - s.x, dz = e.z - s.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;

      const plane = new THREE.PlaneGeometry(len, corridorWidth);
      const cx = (s.x + e.x) / 2, cz = (s.z + e.z) / 2;
      const angle = Math.atan2(dz, dx);

      const mat = new THREE.Matrix4();
      mat.makeRotationX(-Math.PI / 2);
      mat.premultiply(new THREE.Matrix4().makeRotationY(-angle));
      mat.premultiply(new THREE.Matrix4().makeTranslation(cx, 0.02, cz));
      plane.applyMatrix4(mat);
      geometries.push(plane);
    }

    for (const p of pts3) {
      const disc = new THREE.CircleGeometry(halfW, 16);
      const mat = new THREE.Matrix4();
      mat.makeRotationX(-Math.PI / 2);
      mat.premultiply(new THREE.Matrix4().makeTranslation(p.x, 0.02, p.z));
      disc.applyMatrix4(mat);
      geometries.push(disc);
    }
  }

  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  return merged;
}

function buildScene(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
  circulation: CirculationSegment[],
  options: BuildOptions = {}
): { scene: THREE.Scene; center: THREE.Vector3 } {
  const { showWalls = true, showCirculation = false } = options;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dce4ec");

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(10, 15, 10);
  scene.add(dir);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe0e0e0, 0.5));

  const allPoints = rooms.flatMap((r) => r.points);
  const cx = allPoints.length ? allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length / 100 : 0;
  const cz = allPoints.length ? allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length / 100 : 0;

  rooms.forEach((room) => {
    if (room.points.length < 2) return;
    const pts = room.points;

    // Walls
    if (showWalls) {
      const edgeCount = room.isClosed ? pts.length : pts.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const j = (i + 1) % pts.length;
        const ax = pts[i].x / 100, az = -pts[i].y / 100;
        const bx = pts[j].x / 100, bz = -pts[j].y / 100;
        const dx = bx - ax, dz = bz - az;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.01) continue;

        const wallGeo = new THREE.BoxGeometry(len, WALL_HEIGHT, 0.12);
        const wallMat = new THREE.MeshStandardMaterial({ color: "#e2e8f0", roughness: 0.7 });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set((ax + bx) / 2, WALL_HEIGHT / 2, (az + bz) / 2);
        wall.rotation.y = -Math.atan2(dz, dx);
        scene.add(wall);
      }
    }

    // Floor
    if (room.isClosed && pts.length >= 3) {
      const floorPts = pts.map((p) => new THREE.Vector2(p.x / 100, -p.y / 100));
      floorPts.reverse();
      const shape = new THREE.Shape(floorPts);
      const floorGeo = new THREE.ShapeGeometry(shape);
      const floorMat = new THREE.MeshStandardMaterial({ color: "#94a3b8", roughness: 0.9 });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.001;
      scene.add(floor);
    }
  });

  pillars.forEach((p) => {
    const h = (p.height || 280) / 100;
    let geo: THREE.BufferGeometry;
    if (p.shape === "round") {
      geo = new THREE.CylinderGeometry(p.width / 200, p.width / 200, h, 16);
    } else {
      geo = new THREE.BoxGeometry(p.width / 100, h, p.depth / 100);
    }
    const mat = new THREE.MeshStandardMaterial({ color: "#64748b" });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.position.x / 100, h / 2, -p.position.y / 100);
    scene.add(mesh);
  });

  equipments.forEach((eq) => {
    const w = eq.width / 100, d = eq.depth / 100, h = 1.2;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: eq.color || "#8b5cf6" });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(eq.position.x / 100, h / 2, -eq.position.y / 100);
    mesh.rotation.y = -(eq.rotation * Math.PI) / 180;
    scene.add(mesh);
  });

  // Circulation corridor
  if (showCirculation && circulation.length > 0) {
    const cirGeo = buildCirculationGeometry(circulation);
    if (cirGeo) {
      const cirMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x16a34a,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      scene.add(new THREE.Mesh(cirGeo, cirMat));
    }
  }

  return { scene, center: new THREE.Vector3(cx, 1.2, -cz) };
}

function getCameraForView(
  view: CaptureView,
  cx: number,
  cz: number
): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  switch (view) {
    case "top":
      return { position: new THREE.Vector3(cx, 25, cz), lookAt: new THREE.Vector3(cx, 0, cz) };
    case "front":
      return { position: new THREE.Vector3(cx, 3, cz - 18), lookAt: new THREE.Vector3(cx, 1.2, cz) };
    case "side":
      return { position: new THREE.Vector3(cx + 18, 3, cz), lookAt: new THREE.Vector3(cx, 1.2, cz) };
    case "perspective":
    case "perspectiveOpen":
    case "perspectiveCorridor":
    default:
      return { position: new THREE.Vector3(cx + 8, 6, cz + 8), lookAt: new THREE.Vector3(cx, 1.2, cz) };
  }
}

export function capture3DViews(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
  circulation: CirculationSegment[] = []
): Record<CaptureView, string> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(CANVAS_SIZE, CANVAS_SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  const result = {} as Record<CaptureView, string>;

  // Each view may need a different scene variant
  const viewConfigs: { view: CaptureView; showWalls: boolean; showCirculation: boolean }[] = [
    { view: "top", showWalls: true, showCirculation: false },
    { view: "front", showWalls: true, showCirculation: false },
    { view: "side", showWalls: true, showCirculation: false },
    { view: "perspective", showWalls: true, showCirculation: false },
    { view: "perspectiveOpen", showWalls: false, showCirculation: false },
    { view: "perspectiveCorridor", showWalls: false, showCirculation: true },
  ];

  // Group by scene config to reuse scenes
  const sceneCache = new Map<string, { scene: THREE.Scene; center: THREE.Vector3 }>();

  viewConfigs.forEach(({ view, showWalls, showCirculation }) => {
    const key = `${showWalls}-${showCirculation}`;
    if (!sceneCache.has(key)) {
      sceneCache.set(key, buildScene(rooms, doors, pillars, equipments, circulation, { showWalls, showCirculation }));
    }
    const { scene, center } = sceneCache.get(key)!;
    const cam = getCameraForView(view, center.x, center.z);
    camera.position.copy(cam.position);
    camera.lookAt(cam.lookAt);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    result[view] = renderer.domElement.toDataURL("image/png");
  });

  // Cleanup
  renderer.dispose();
  sceneCache.forEach(({ scene }) => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  });

  return result;
}
