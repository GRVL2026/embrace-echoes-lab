export type Point = { x: number; y: number };

export type Wall = {
  id: string;
  start: Point;
  end: Point;
};

export type Room = {
  id: string;
  points: Point[]; // closed polygon
  walls: Wall[];
  name: string;
};

export type Door = {
  id: string;
  position: Point;
  width: number; // in cm
  wallId: string;
};

export type EditorTool = "select" | "wall" | "door" | "pan" | "eraser";

export type EditorState = {
  tool: EditorTool;
  rooms: Room[];
  doors: Door[];
  zoom: number;
  panOffset: Point;
  gridSize: number; // in cm, default 20
  snapToGrid: boolean;
  showDimensions: boolean;
};

export const INITIAL_EDITOR_STATE: EditorState = {
  tool: "wall",
  rooms: [],
  doors: [],
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  gridSize: 20,
  snapToGrid: true,
  showDimensions: true,
};

// 1 meter = 100cm, 1cm = 2px at zoom 1
export const CM_TO_PX = 2;
export const SAFETY_ZONE_CM = 140; // 1m40 zone de circulation
