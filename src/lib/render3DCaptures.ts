/**
 * Offscreen Three.js renderer to capture 4 views (top, front, side, perspective)
 * without depending on R3F context.
 */
import * as THREE from "three";
import type { Room, Door, Pillar } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";

const WALL_HEIGHT = 2.8; // meters
const CANVAS_SIZE = 1200;

type CaptureView = "top" | "front" | "side" | "perspective";

function buildScene(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[]
): { scene: THREE.Scene; center: THREE.Vector3 } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dce4ec");

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(10, 15, 10);
  scene.add(dir);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe0e0e0, 0.5));

  const allPoints = rooms.flatMap((r) => r.points);
  const cx = allPoints.length ? allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length / 100 : 0;
  const cz = allPoints.length ? allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length / 100 : 0;

  // Rooms (walls + floor)
  rooms.forEach((room) => {
    if (room.points.length < 2) return;
    const pts = room.points;
    const edgeCount = room.isClosed ? pts.length : pts.length - 1;

    // Walls
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

  // Pillars
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

  // Equipment
  equipments.forEach((eq) => {
    const w = eq.width / 100, d = eq.depth / 100, h = 1.2;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: eq.color || "#8b5cf6" });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(eq.position.x / 100, h / 2, -eq.position.y / 100);
    mesh.rotation.y = -(eq.rotation * Math.PI) / 180;
    scene.add(mesh);
  });

  return { scene, center: new THREE.Vector3(cx, 1.2, -cz) };
}

function getCameraForView(
  view: CaptureView,
  cx: number,
  cz: number
): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  switch (view) {
    case "top":
      return {
        position: new THREE.Vector3(cx, 25, cz),
        lookAt: new THREE.Vector3(cx, 0, cz),
      };
    case "front":
      return {
        position: new THREE.Vector3(cx, 3, cz - 18),
        lookAt: new THREE.Vector3(cx, 1.2, cz),
      };
    case "side":
      return {
        position: new THREE.Vector3(cx + 18, 3, cz),
        lookAt: new THREE.Vector3(cx, 1.2, cz),
      };
    case "perspective":
    default:
      return {
        position: new THREE.Vector3(cx + 8, 6, cz + 8),
        lookAt: new THREE.Vector3(cx, 1.2, cz),
      };
  }
}

export function capture3DViews(
  rooms: Room[],
  doors: Door[],
  pillars: Pillar[],
  equipments: PlacedEquipment[]
): Record<CaptureView, string> {
  const { scene, center } = buildScene(rooms, doors, pillars, equipments);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(CANVAS_SIZE, CANVAS_SIZE);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

  const views: CaptureView[] = ["top", "front", "side", "perspective"];
  const result = {} as Record<CaptureView, string>;

  views.forEach((view) => {
    const cam = getCameraForView(view, center.x, center.z);
    camera.position.copy(cam.position);
    camera.lookAt(cam.lookAt);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    result[view] = renderer.domElement.toDataURL("image/png");
  });

  // Cleanup
  renderer.dispose();
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
    if ((obj as THREE.Mesh).material) {
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });

  return result;
}
