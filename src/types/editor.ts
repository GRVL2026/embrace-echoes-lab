export type Point = { x: number; y: number };

export type Wall = {
  id: string;
  start: Point;
  end: Point;
};

export type Room = {
  id: string;
  points: Point[]; // polygon (closed or open polyline)
  walls: Wall[];
  name: string;
  isClosed: boolean; // true = closed polygon, false = open polyline
};

export type DoorOpenDirection = "left" | "right"; // hinge side relative to wall direction
export type DoorOpenSide = "interior" | "exterior"; // which side of the wall the door opens toward
export type DoorLeafCount = "single" | "double";

export type Door = {
  id: string;
  roomId: string;
  edgeIndex: number; // which edge of the room polygon
  positionRatio: number; // 0–1 along the wall
  width: number; // in cm
  openDirection: DoorOpenDirection; // hinge side (left battant for single, left battant for double)
  openDirectionRight?: DoorOpenDirection; // right battant direction (double only)
  openSide: DoorOpenSide;
  leafCount: DoorLeafCount;
};

export type PillarShape = "square" | "round";

export type Pillar = {
  id: string;
  position: Point; // center position in cm
  shape: PillarShape;
  width: number; // in cm (diameter for round)
  depth: number; // in cm (ignored for round)
  height: number; // in cm
  rotation: number; // in degrees
};

export type EditorTool = "select" | "wall" | "door" | "pillar" | "pan" | "eraser";

/** Circulation path segment for safety display */
export type CirculationSegment = {
  start: Point;
  end: Point;
  width: number; // corridor width in cm
};

export type EditorState = {
  tool: EditorTool;
  rooms: Room[];
  doors: Door[];
  pillars: Pillar[];
  zoom: number;
  panOffset: Point;
  gridSize: number; // in cm, default 20
  snapToGrid: boolean;
  showDimensions: boolean;
  showAngles: boolean;
  showPillarDistances: boolean;
  placedEquipments: import("@/types/equipment").PlacedEquipment[];
  circulationPath: CirculationSegment[]; // safety circulation display
};

export const INITIAL_EDITOR_STATE: EditorState = {
  tool: "wall",
  rooms: [],
  doors: [],
  pillars: [],
  placedEquipments: [],
  circulationPath: [],
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  gridSize: 20,
  snapToGrid: true,
  showDimensions: true,
  showAngles: false,
  showPillarDistances: false,
};

// Scale: 1cm = 1px at zoom 1 (allows ~20m horizontal view on standard screens)
export const CM_TO_PX = 1;
export const SAFETY_ZONE_CM = 140; // 1m40 zone de circulation
