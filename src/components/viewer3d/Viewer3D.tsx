import { useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, PointerLockControls } from "@react-three/drei";
import { useEditor } from "@/contexts/EditorContext";
import { Room3D } from "./Room3D";
import { Equipment3D } from "./Equipment3D";
import { ArcadeLighting } from "./ArcadeLighting";
import { Pillar3D } from "./Pillar3D";
import { Circulation3D } from "./Circulation3D";
import { Door3D } from "./Door3D";
import { Ceiling3D } from "./Ceiling3D";
import { SceneFog } from "./SceneFog";
import { SceneCapturer } from "./SceneCapturer";
import { HDRIEnvironment } from "./HDRIEnvironment";
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

/** Sync a Three.js group's visibility with a React boolean */
function useGroupVisibility(ref: React.RefObject<THREE.Group | null>, visible: boolean) {
  useEffect(() => {
    if (ref.current) ref.current.visible = visible;
  }, [ref, visible]);
}

export function Viewer3D({ settings, onPresetApplied }: Props) {
  const { state } = useEditor();
  const wallGroupRef = useRef<THREE.Group>(null);
  const circulationGroupRef = useRef<THREE.Group>(null);
  const gridGroupRef = useRef<THREE.Group>(null);

  const allPoints = state.rooms.flatMap((r) => r.points);
  const cx = allPoints.length
    ? allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length / 100
    : 0;
  const cz = allPoints.length
    ? allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length / 100
    : 0;

  // Compute room floor extent (bounding box in cm) for proportional asset scaling
  const roomExtent = useMemo(() => {
    if (allPoints.length < 2) return { width: 500, depth: 500 };
    const xs = allPoints.map(p => p.x);
    const ys = allPoints.map(p => p.y);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...ys) - Math.min(...ys),
    };
  }, [allPoints]);

  const vis = settings.visibility;
  const ambiance = settings.ambiance ?? { floorTexture: "default" as const, wallFinish: "default" as const, wallColor: "#f0f0f0", ceiling: "none" as const, fog: false, fogIntensity: 0.3, theme: "custom" as const };
  const bgColor = settings.lighting === "arcade" ? "#0f0f23" : "#dce4ec";
  const fogColor = settings.lighting === "arcade" ? "#0f0f23" : settings.lighting === "showroom" ? "#1a1a2e" : "#c8d0d8";

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
        gl={{ antialias: true, toneMapping: 3, preserveDrawingBuffer: true }}
      >
        {/* Scene capturer for PDF export */}
        <SceneCapturer
          cx={cx}
          cz={cz}
          wallObjects={wallGroupRef}
          circulationObjects={circulationGroupRef}
          gridObjects={gridGroupRef}
        />

        {/* Fog */}
        <SceneFog enabled={ambiance.fog} intensity={ambiance.fogIntensity} color={fogColor} />

        {/* HDRI Environment */}
        <HDRIEnvironment
          hdri={ambiance.polyhavenHDRI}
          intensity={ambiance.hdriIntensity}
          showBackground={ambiance.hdriBackground}
        />

        {/* Lighting */}
        <SceneLighting preset={settings.lighting} />

        {/* Arcade-specific room lighting */}
        {settings.lighting !== "arcade" && <ArcadeLighting rooms={state.rooms} />}

        {/* Rooms (walls + floor) — always rendered, visibility controlled via group */}
        <group ref={wallGroupRef}>
          <Suspense fallback={null}>
            {state.rooms.map((room) => (
              <Room3D key={room.id} room={room} doors={state.doors} showFloor={vis.floor} showWalls={vis.walls} ambiance={settings.ambiance} />
            ))}
          </Suspense>
        </group>

        {/* Ceilings */}
        {ambiance.ceiling !== "none" && (
          <Suspense fallback={null}>
            {state.rooms.map((room) => (
              <Ceiling3D key={`ceil-${room.id}`} room={room} ceilingType={ambiance.ceiling} height={ambiance.ceilingHeight} polyhavenTexture={ambiance.polyhavenCeiling} />
            ))}
          </Suspense>
        )}

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
            <Equipment3D key={eq.id} equipment={eq} showHeight={vis.heights} roomExtent={roomExtent} />
          ))}

        {/* Circulation path */}
        <group ref={circulationGroupRef} visible={vis.circulation}>
          {state.circulationPath && state.circulationPath.length > 0 && (
            <Circulation3D segments={state.circulationPath} />
          )}
        </group>

        {/* Ground grid — wrapped for capture control */}
        <group ref={gridGroupRef}>
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
        </group>

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
