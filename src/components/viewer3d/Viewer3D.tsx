import { useRef, useEffect, useCallback } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, PointerLockControls } from "@react-three/drei";
import { useEditor } from "@/contexts/EditorContext";
import { Room3D } from "./Room3D";
import { Equipment3D } from "./Equipment3D";
import { ArcadeLighting } from "./ArcadeLighting";
import { Pillar3D } from "./Pillar3D";
import { Door3D } from "./Door3D";
import * as THREE from "three";
import type { Viewer3DSettings, PresetView, LightingPreset } from "./Viewer3DToolbar";

type Props = {
  settings: Viewer3DSettings;
  onPresetApplied?: () => void;
};

/** Lighting configurations */
function SceneLighting({ preset }: { preset: LightingPreset }) {
  if (preset === "arcade") {
    return (
      <>
        <ambientLight intensity={0.15} color="#1a1a2e" />
        <pointLight position={[5, 4, 5]} intensity={0.8} color="#9333ea" distance={20} />
        <pointLight position={[10, 4, 3]} intensity={0.6} color="#3b82f6" distance={15} />
        <pointLight position={[8, 4, 7]} intensity={0.5} color="#ec4899" distance={15} />
        <hemisphereLight args={["#1e1b4b", "#0f0f23", 0.3]} />
      </>
    );
  }
  if (preset === "showroom") {
    return (
      <>
        <ambientLight intensity={0.4} color="#fff5e6" />
        <directionalLight position={[10, 12, 8]} intensity={1.5} color="#fff8f0" castShadow />
        <spotLight position={[5, 5, 5]} intensity={1.2} angle={0.6} penumbra={0.5} color="#ffffff" />
        <spotLight position={[10, 5, 3]} intensity={1.0} angle={0.6} penumbra={0.5} color="#ffffff" />
        <hemisphereLight args={["#ffffff", "#e8e8e8", 0.4]} />
      </>
    );
  }
  // daylight (default)
  return (
    <>
      <ambientLight intensity={0.6} color="#ffffff" />
      <directionalLight position={[10, 15, 10]} intensity={1.2} color="#ffffff" castShadow />
      <hemisphereLight args={["#ffffff", "#e0e0e0", 0.5]} />
    </>
  );
}

/** Camera controller for preset views and first-person */
function CameraController({
  cx,
  cz,
  presetView,
  firstPerson,
  onPresetApplied,
}: {
  cx: number;
  cz: number;
  presetView: PresetView;
  firstPerson: boolean;
  onPresetApplied?: () => void;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const animating = useRef(false);
  const targetPos = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3(cx, 1.2, cz));

  useEffect(() => {
    if (!presetView) return;

    const look = new THREE.Vector3(cx, 1.2, cz);
    let pos: THREE.Vector3;

    switch (presetView) {
      case "top":
        pos = new THREE.Vector3(cx, 25, cz);
        look.set(cx, 0, cz);
        break;
      case "front":
        pos = new THREE.Vector3(cx, 3, cz + 18);
        break;
      case "side":
        pos = new THREE.Vector3(cx + 18, 3, cz);
        break;
      case "perspective":
      default:
        pos = new THREE.Vector3(cx + 8, 6, cz + 8);
        break;
    }

    targetPos.current.copy(pos);
    targetLook.current.copy(look);
    animating.current = true;
  }, [presetView, cx, cz]);

  useFrame(() => {
    if (!animating.current) return;

    camera.position.lerp(targetPos.current, 0.08);
    if (controlsRef.current?.target) {
      controlsRef.current.target.lerp(targetLook.current, 0.08);
      controlsRef.current.update();
    }

    if (camera.position.distanceTo(targetPos.current) < 0.05) {
      animating.current = false;
      onPresetApplied?.();
    }
  });

  if (firstPerson) {
    return <PointerLockControls />;
  }

  return (
    <OrbitControls
      ref={controlsRef}
      target={[cx, 1.2, cz]}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={2}
      maxDistance={40}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

/** First-person ZQSD movement */
function FirstPersonMovement({ active }: { active: boolean }) {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());
  const speed = 0.12;

  useEffect(() => {
    if (!active) return;
    const onDown = (e: KeyboardEvent) => keys.current.add(e.code);
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      keys.current.clear();
    };
  }, [active]);

  useFrame(() => {
    if (!active) return;
    const direction = new THREE.Vector3();
    const right = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    right.crossVectors(direction, camera.up).normalize();

    if (keys.current.has("KeyW") || keys.current.has("KeyZ")) camera.position.addScaledVector(direction, speed);
    if (keys.current.has("KeyS")) camera.position.addScaledVector(direction, -speed);
    if (keys.current.has("KeyA") || keys.current.has("KeyQ")) camera.position.addScaledVector(right, -speed);
    if (keys.current.has("KeyD")) camera.position.addScaledVector(right, speed);
    
    // Keep at eye height
    camera.position.y = 1.7;
  });

  return null;
}

export function Viewer3D({ settings, onPresetApplied }: Props) {
  const { state } = useEditor();

  const allPoints = state.rooms.flatMap((r) => r.points);
  const cx = allPoints.length
    ? allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length / 100
    : 0;
  const cz = allPoints.length
    ? allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length / 100
    : 0;

  const vis = settings.visibility;
  const bgColor = settings.lighting === "arcade" ? "#0f0f23" : "#dce4ec";

  return (
    <div className="flex-1 w-full h-full" style={{ background: bgColor }}>
      <Canvas
        shadows
        camera={{
          position: [cx + 8, 6, cz + 8],
          fov: 55,
          near: 0.1,
          far: 200,
        }}
        gl={{ antialias: true, toneMapping: 3 }}
      >
        {/* Lighting */}
        <SceneLighting preset={settings.lighting} />

        {/* Arcade-specific room lighting */}
        {settings.lighting !== "arcade" && <ArcadeLighting rooms={state.rooms} />}

        {/* Rooms (walls + floor) */}
        {vis.walls &&
          state.rooms.map((room) => (
            <Room3D key={room.id} room={room} doors={state.doors} showFloor={vis.floor} />
          ))}

        {/* Floor only (when walls hidden but floor visible) */}
        {!vis.walls &&
          vis.floor &&
          state.rooms.map((room) => (
            <Room3D key={`floor-${room.id}`} room={room} doors={[]} showFloor={true} showWalls={false} />
          ))}

        {/* Pillars */}
        {vis.pillars &&
          state.pillars.map((pillar) => (
            <Pillar3D key={pillar.id} pillar={pillar} />
          ))}

        {/* Doors */}
        {vis.doors &&
          state.doors.map((door) => (
            <Door3D key={door.id} door={door} rooms={state.rooms} />
          ))}

        {/* Equipment */}
        {vis.equipment &&
          state.placedEquipments.map((eq) => (
            <Equipment3D key={eq.id} equipment={eq} />
          ))}

        {/* Ground grid */}
        {vis.grid && (
          <Grid
            position={[cx, -0.01, cz]}
            args={[50, 50]}
            cellSize={1}
            cellThickness={0.5}
            cellColor={settings.lighting === "arcade" ? "#2a2a4a" : "#c0c0c0"}
            sectionSize={5}
            sectionThickness={1}
            sectionColor={settings.lighting === "arcade" ? "#4a4a6a" : "#999999"}
            fadeDistance={30}
            infiniteGrid
          />
        )}

        {/* Camera controls */}
        <CameraController
          cx={cx}
          cz={cz}
          presetView={settings.presetView}
          firstPerson={settings.firstPerson}
          onPresetApplied={onPresetApplied}
        />

        {/* First person movement */}
        <FirstPersonMovement active={settings.firstPerson} />
      </Canvas>
    </div>
  );
}
