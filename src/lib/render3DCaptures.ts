/**
 * Offscreen Three.js renderer to capture 6 views:
 * top, front, side, perspective, perspectiveOpen (no walls), perspectiveCorridor
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Room, Door, Pillar, CirculationSegment, Point } from "@/types/editor";
import type { PlacedEquipment, GameEquipment } from "@/types/equipment";

const WALL_HEIGHT = 2.8;
const CANVAS_SIZE = 1200;

export type CaptureView = "top" | "front" | "side" | "perspective" | "perspectiveOpen" | "perspectiveCorridor";

type BuildOptions = {
  showWalls?: boolean;
  showCirculation?: boolean;
};

function buildCirculationGeometry(segments: CirculationSegment[]): THREE.BufferGeometry | null {
  if (!segments || segments.length === 0) return null;

  const corridorWidth = (segments[0]?.width || 120) / 100;
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
      const floorPts = pts.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));
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

  // Equipment placeholders (will be replaced by GLB models in async build)
  equipments.forEach((eq) => {
    const w = eq.width / 100, d = eq.depth / 100, h = (eq.height || 120) / 100;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: eq.color || "#8b5cf6" });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(eq.position.x / 100, h / 2, -eq.position.y / 100);
    mesh.rotation.y = -(eq.rotation * Math.PI) / 180;
    mesh.userData._equipmentPlaceholder = true;
    mesh.userData._equipmentData = eq;
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

/** Load a GLB model and fit it into the given dimensions */
async function loadGLBModel(url: string, width: number, depth: number, height: number): Promise<THREE.Group | null> {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene.clone(true);

    // Fix texture color spaces
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const fixMat = (m: THREE.Material) => {
          const mat = m.clone();
          const std = mat as THREE.MeshStandardMaterial;
          if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
          if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          if (std.aoMap) std.aoMap.colorSpace = THREE.SRGBColorSpace;
          return mat;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(fixMat);
        } else if (mesh.material) {
          mesh.material = fixMat(mesh.material);
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    const targetW = width / 100, targetD = depth / 100, targetH = height / 100;
    const scaleX = size.x > 0 ? targetW / size.x : 1;
    const scaleY = size.y > 0 ? targetH / size.y : 1;
    const scaleZ = size.z > 0 ? targetD / size.z : 1;
    const scale = Math.min(scaleX, scaleY, scaleZ);
    model.scale.setScalar(scale);

    const newBox = new THREE.Box3().setFromObject(model);
    const center = newBox.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.position.y += newBox.getSize(new THREE.Vector3()).y / 2;

    return model;
  } catch (e) {
    console.warn("GLB load failed for PDF capture:", url, e);
    return null;
  }
}

/** Replace placeholder boxes with loaded GLB models in all cached scenes */
async function replaceWithGLBModels(
  sceneCache: Map<string, { scene: THREE.Scene; center: THREE.Vector3 }>,
  equipments: PlacedEquipment[]
): Promise<void> {
  // Collect unique model URLs
  const urlSet = new Map<string, PlacedEquipment>();
  equipments.forEach((eq) => {
    if (eq.model3d && !urlSet.has(eq.model3d)) {
      urlSet.set(eq.model3d, eq);
    }
  });

  if (urlSet.size === 0) return;

  // Pre-load all unique GLB models in parallel
  const modelCache = new Map<string, THREE.Group | null>();
  await Promise.all(
    Array.from(urlSet.entries()).map(async ([url, eq]) => {
      const model = await loadGLBModel(url, eq.width, eq.depth, eq.height || 120);
      modelCache.set(url, model);
    })
  );

  // Replace placeholders in every scene
  sceneCache.forEach(({ scene }) => {
    const toRemove: THREE.Object3D[] = [];
    const toAdd: THREE.Object3D[] = [];

    scene.traverse((obj) => {
      if (obj.userData._equipmentPlaceholder) {
        const eq = obj.userData._equipmentData as PlacedEquipment;
        if (eq.model3d && modelCache.has(eq.model3d)) {
          const template = modelCache.get(eq.model3d);
          if (template) {
            const clone = template.clone(true);
            const group = new THREE.Group();
            group.add(clone);
            group.position.set(eq.position.x / 100, 0, -eq.position.y / 100);
            group.rotation.y = -(eq.rotation * Math.PI) / 180;
            toRemove.push(obj);
            toAdd.push(group);
          }
        }
      }
    });

    toRemove.forEach((obj) => scene.remove(obj));
    toAdd.forEach((obj) => scene.add(obj));
  });
}

export async function capture3DViews(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
  circulation: CirculationSegment[] = []
): Promise<Record<CaptureView, string>> {
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

  viewConfigs.forEach(({ showWalls, showCirculation }) => {
    const key = `${showWalls}-${showCirculation}`;
    if (!sceneCache.has(key)) {
      sceneCache.set(key, buildScene(rooms, doors, pillars, equipments, circulation, { showWalls, showCirculation }));
    }
  });

  // Load GLB models and replace placeholder boxes
  await replaceWithGLBModels(sceneCache, equipments);

  viewConfigs.forEach(({ view, showWalls, showCirculation }) => {
    const key = `${showWalls}-${showCirculation}`;
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

/**
 * Rendu d'une vue unique 16:9 pour la passe photoréaliste du Planner, 100 % fidèle au plan 2D :
 *  - murs aux dimensions exactes du polygone (buildScene) ;
 *  - chaque machine à sa position ET son orientation du plan ; GLB quand il existe (angle correct
 *    par la perspective 3D), sinon billboard texturé de la photo de fiche (face caméra) ;
 *  - caméra calculée depuis le plan pour que TOUTES les machines tiennent dans le cadre.
 * Renvoie le dataURL JPEG à envoyer à l'edge generer-vue.
 */
export async function renderPlannerScene(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[],
  circulation: CirculationSegment[],
  catalog: GameEquipment[],
): Promise<{ dataUrl: string; count: number }> {
  const W = 1600, H = 900;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H); renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Enrichit chaque machine avec le model3d/cotes du catalogue si le plan (ancien) ne les porte pas
  // -> les GLB fraîchement reconstruits s'appliquent même aux plans déjà enregistrés.
  const eqs = equipments.map((e) => {
    const cat = catalog.find((c) => c.id === e.equipmentId);
    return {
      ...e,
      model3d: e.model3d || cat?.model3d,
      height: e.height || cat?.height,
      width: e.width || cat?.width,
      depth: e.depth || cat?.depth,
    };
  });

  const built = buildScene(rooms, doors, pillars, eqs, circulation, { showWalls: true });
  const scene = built.scene;
  scene.background = new THREE.Color("#b8bcc2"); // gris neutre (Krea repeint la salle)

  // GLB pour les machines qui en ont un (position + rotation exactes).
  await replaceWithGLBModels(new Map([["k", built]]), eqs);

  // Plafond gris : ferme la boîte pour que Krea rende une salle close.
  const rp = rooms.flatMap((r) => r.points);
  if (rp.length) {
    const xs = rp.map((p) => p.x / 100), zs = rp.map((p) => -p.y / 100);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0),
      new THREE.MeshStandardMaterial({ color: "#c2c6cc", side: THREE.DoubleSide }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((x0 + x1) / 2, WALL_HEIGHT, (z0 + z1) / 2);
    scene.add(ceil);
  }

  // Caméra dérivée du plan : cadre toutes les machines (fit sphère englobante).
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
  const P = eqs.map((e) => ({ x: e.position.x / 100, z: -e.position.y / 100, h: (e.height || 120) / 100 }));
  let camPos: THREE.Vector3, target: THREE.Vector3;
  if (P.length) {
    const xs = P.map((p) => p.x), zs = P.map((p) => p.z);
    const mnx = Math.min(...xs), mxx = Math.max(...xs), mnz = Math.min(...zs), mxz = Math.max(...zs);
    const maxh = Math.max(...P.map((p) => p.h), 1.2);
    const cxm = (mnx + mxx) / 2, czm = (mnz + mxz) / 2;
    const R = 0.5 * Math.hypot(mxx - mnx, mxz - mnz, maxh) + 1.0;
    const rcx = rp.reduce((s, p) => s + p.x, 0) / (rp.length || 1) / 100;
    const rcz = rp.reduce((s, p) => s + -p.y, 0) / (rp.length || 1) / 100;
    const dx = cxm - rcx, dz = czm - rcz, l = Math.hypot(dx, dz);
    let dirx: number, dirz: number;
    if (l > 0.5) { dirx = -dx / l; dirz = -dz / l; }             // caméra du côté libre, face aux machines
    else if ((mxx - mnx) >= (mxz - mnz)) { dirx = 0; dirz = -1; } // machines centrées -> vue selon l'axe court
    else { dirx = -1; dirz = 0; }
    const fov = (50 * Math.PI) / 180;
    const dist = Math.max(3, (R / Math.sin(fov / 2)) * 1.1);
    camPos = new THREE.Vector3(cxm + dirx * dist, 1.85, czm + dirz * dist);
    target = new THREE.Vector3(cxm, Math.min(1.2, maxh * 0.55), czm);
  } else {
    camPos = new THREE.Vector3(built.center.x, 6, built.center.z + 8);
    target = built.center;
  }
  cam.position.copy(camPos); cam.lookAt(target); cam.updateProjectionMatrix();

  // Machines sans GLB -> billboard texturé (vraie photo de fiche), face à la caméra.
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
  const placeholders: THREE.Object3D[] = [];
  scene.traverse((o) => { if (o.userData._equipmentPlaceholder) placeholders.push(o); });
  for (const ph of placeholders) {
    const eq = ph.userData._equipmentData as PlacedEquipment;
    const url = catalog.find((c) => c.id === eq.equipmentId)?.images?.[0];
    if (!url) continue; // pas de photo -> on garde la boîte colorée
    let tex: THREE.Texture | null = null;
    try { tex = await loader.loadAsync(url); tex.colorSpace = THREE.SRGBColorSpace; } catch { tex = null; }
    if (!tex) continue;
    // Boîte 3D aux cotes réelles : vrai volume + empreinte + occlusion ; la photo va sur
    // la face qui regarde le plus la caméra (artwork toujours visible, jamais contre un mur),
    // les autres faces en matériau neutre (côtés de borne). Krea relighte ensuite.
    const w = eq.width / 100, h = (eq.height || 120) / 100, d = Math.max(0.25, eq.depth / 100);
    const px = eq.position.x / 100, pz = -eq.position.y / 100;
    const theta = -(eq.rotation * Math.PI) / 180;
    const cdx = camPos.x - px, cdz = camPos.z - pz, cl = Math.hypot(cdx, cdz) || 1;
    const faces = [{ i: 0, n: [1, 0] }, { i: 1, n: [-1, 0] }, { i: 4, n: [0, 1] }, { i: 5, n: [0, -1] }];
    let bestI = 4, bestDot = -Infinity;
    for (const f of faces) {
      const wx = f.n[0] * Math.cos(theta) + f.n[1] * Math.sin(theta);
      const wz = -f.n[0] * Math.sin(theta) + f.n[1] * Math.cos(theta);
      const dp = (wx * cdx + wz * cdz) / cl;
      if (dp > bestDot) { bestDot = dp; bestI = f.i; }
    }
    const neutral = new THREE.MeshStandardMaterial({ color: "#34363c", roughness: 0.85 });
    const photoMat = new THREE.MeshBasicMaterial({ map: tex });
    const mats = [0, 1, 2, 3, 4, 5].map((i) => (i === bestI ? photoMat : neutral));
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    box.position.set(px, h / 2, pz);
    box.rotation.y = theta;
    scene.remove(ph); scene.add(box);
  }

  renderer.render(scene, cam);
  const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.9);
  renderer.dispose();
  return { dataUrl, count: equipments.length };
}
