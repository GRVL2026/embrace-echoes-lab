import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { useEditor } from "@/contexts/EditorContext";
import { Room3D } from "./Room3D";
import { Equipment3D } from "./Equipment3D";
import { ArcadeLighting } from "./ArcadeLighting";
import { Pillar3D } from "./Pillar3D";

export function Viewer3D() {
  const { state } = useEditor();

  // Calculate scene center from rooms for camera target
  const allPoints = state.rooms.flatMap((r) => r.points);
  const cx = allPoints.length
    ? allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length / 100
    : 0;
  const cz = allPoints.length
    ? allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length / 100
    : 0;

  return (
    <div className="flex-1 w-full h-full bg-black">
      <Canvas
        shadows
        camera={{
          position: [cx + 8, 6, cz + 8],
          fov: 55,
          near: 0.1,
          far: 200,
        }}
        gl={{ antialias: true, toneMapping: 3 /* ACESFilmic */ }}
      >
        {/* Ambient base */}
        <ambientLight intensity={0.15} color="#1a1a3e" />

        {/* Arcade lighting */}
        <ArcadeLighting rooms={state.rooms} />

        {/* Rooms (walls + floor) */}
        {state.rooms.map((room) => (
          <Room3D key={room.id} room={room} doors={state.doors} />
        ))}

        {/* Pillars */}
        {state.pillars.map((pillar) => (
          <Pillar3D key={pillar.id} pillar={pillar} />
        ))}

        {/* Equipment */}
        {state.placedEquipments.map((eq) => (
          <Equipment3D key={eq.id} equipment={eq} />
        ))}

        {/* Ground grid */}
        <Grid
          position={[cx, -0.01, cz]}
          args={[50, 50]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1a1a3e"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#2a2a5e"
          fadeDistance={30}
          infiniteGrid
        />

        {/* Controls */}
        <OrbitControls
          target={[cx, 1.2, cz]}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={2}
          maxDistance={40}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
}
