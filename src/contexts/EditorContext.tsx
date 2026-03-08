import React, { createContext, useContext, useReducer, useCallback, type ReactNode } from "react";
import { type EditorState, type EditorTool, type Point, type Room, type Door, type Pillar, type CirculationSegment, INITIAL_EDITOR_STATE } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";

type EditorAction =
  | { type: "SET_TOOL"; tool: EditorTool }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_PAN"; offset: Point }
  | { type: "ADD_ROOM"; room: Room }
  | { type: "UPDATE_ROOM"; id: string; room: Partial<Room> }
  | { type: "DELETE_ROOM"; id: string }
  | { type: "DELETE_WALL"; roomId: string; edgeIndex: number }
  | { type: "ADD_DOOR"; door: Door }
  | { type: "UPDATE_DOOR"; id: string; door: Partial<Door> }
  | { type: "DELETE_DOOR"; id: string }
  | { type: "ADD_PILLAR"; pillar: Pillar }
  | { type: "UPDATE_PILLAR"; id: string; pillar: Partial<Pillar> }
  | { type: "DELETE_PILLAR"; id: string }
  | { type: "ADD_PLACED_EQUIPMENT"; equipment: PlacedEquipment }
  | { type: "ADD_PLACED_EQUIPMENTS"; equipments: PlacedEquipment[] }
  | { type: "UPDATE_PLACED_EQUIPMENT"; id: string; equipment: Partial<PlacedEquipment> }
  | { type: "DELETE_PLACED_EQUIPMENT"; id: string }
  | { type: "CLEAR_PLACED_EQUIPMENTS" }
  | { type: "SET_CIRCULATION"; circulation: CirculationSegment[] }
  | { type: "TOGGLE_SNAP" }
  | { type: "TOGGLE_PILLAR_DISTANCES" }
  | { type: "TOGGLE_DIMENSIONS" }
  | { type: "TOGGLE_ANGLES" }
  | { type: "TOGGLE_CIRCULATION" }
  | { type: "SET_GRID_SIZE"; size: number }
  | { type: "UNDO" }
  | { type: "RESET" }
  | { type: "LOAD_STATE"; state: Partial<EditorState> };

// Actions that modify geometry and should be undoable
const UNDOABLE_ACTIONS = new Set([
  "ADD_ROOM", "DELETE_WALL",
  "ADD_DOOR", "DELETE_DOOR",
  "ADD_PILLAR", "DELETE_PILLAR",
  "ADD_PLACED_EQUIPMENT", "ADD_PLACED_EQUIPMENTS",
  "DELETE_PLACED_EQUIPMENT", "CLEAR_PLACED_EQUIPMENTS",
]);

const MAX_UNDO_HISTORY = 50;

type UndoableState = {
  current: EditorState;
  history: EditorState[]; // past states (most recent last)
};

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_TOOL":
      return { ...state, tool: action.tool };
    case "SET_ZOOM":
      return { ...state, zoom: Math.max(0.2, Math.min(5, action.zoom)) };
    case "SET_PAN":
      return { ...state, panOffset: action.offset };
    case "ADD_ROOM":
      return { ...state, rooms: [...state.rooms, action.room] };
    case "UPDATE_ROOM":
      return {
        ...state,
        rooms: state.rooms.map((r) => (r.id === action.id ? { ...r, ...action.room } : r)),
      };
    case "DELETE_ROOM":
      return {
        ...state,
        rooms: state.rooms.filter((r) => r.id !== action.id),
        doors: state.doors.filter((d) => d.roomId !== action.id),
      };
    case "DELETE_WALL": {
      const room = state.rooms.find((r) => r.id === action.roomId);
      if (!room) return state;
      const newPoints = room.points.filter((_, i) => i !== action.edgeIndex);
      if (newPoints.length < 3) {
        return {
          ...state,
          rooms: state.rooms.filter((r) => r.id !== action.roomId),
          doors: state.doors.filter((d) => d.roomId !== action.roomId),
        };
      }
      const updatedDoors = state.doors
        .filter((d) => !(d.roomId === action.roomId && d.edgeIndex === action.edgeIndex))
        .map((d) => {
          if (d.roomId === action.roomId && d.edgeIndex > action.edgeIndex) {
            return { ...d, edgeIndex: d.edgeIndex - 1 };
          }
          return d;
        });
      return {
        ...state,
        rooms: state.rooms.map((r) =>
          r.id === action.roomId ? { ...r, points: newPoints } : r
        ),
        doors: updatedDoors,
      };
    }
    case "ADD_DOOR":
      return { ...state, doors: [...state.doors, action.door] };
    case "UPDATE_DOOR":
      return {
        ...state,
        doors: state.doors.map((d) => (d.id === action.id ? { ...d, ...action.door } : d)),
      };
    case "DELETE_DOOR":
      return { ...state, doors: state.doors.filter((d) => d.id !== action.id) };
    case "ADD_PILLAR":
      return { ...state, pillars: [...state.pillars, action.pillar] };
    case "UPDATE_PILLAR":
      return {
        ...state,
        pillars: state.pillars.map((p) => (p.id === action.id ? { ...p, ...action.pillar } : p)),
      };
    case "DELETE_PILLAR":
      return { ...state, pillars: state.pillars.filter((p) => p.id !== action.id) };
    case "ADD_PLACED_EQUIPMENT":
      return { ...state, placedEquipments: [...state.placedEquipments, action.equipment] };
    case "ADD_PLACED_EQUIPMENTS":
      return { ...state, placedEquipments: [...state.placedEquipments, ...action.equipments] };
    case "UPDATE_PLACED_EQUIPMENT":
      return {
        ...state,
        placedEquipments: state.placedEquipments.map((e) =>
          e.id === action.id ? { ...e, ...action.equipment } : e
        ),
      };
    case "DELETE_PLACED_EQUIPMENT":
      return { ...state, placedEquipments: state.placedEquipments.filter((e) => e.id !== action.id) };
    case "CLEAR_PLACED_EQUIPMENTS":
      return { ...state, placedEquipments: [], circulationPath: [] };
    case "SET_CIRCULATION":
      return { ...state, circulationPath: action.circulation };
    case "TOGGLE_SNAP":
      return { ...state, snapToGrid: !state.snapToGrid };
    case "TOGGLE_DIMENSIONS":
      return { ...state, showDimensions: !state.showDimensions };
    case "TOGGLE_ANGLES":
      return { ...state, showAngles: !state.showAngles };
    case "TOGGLE_PILLAR_DISTANCES":
      return { ...state, showPillarDistances: !state.showPillarDistances };
    case "TOGGLE_CIRCULATION":
      return { ...state, showCirculation: !state.showCirculation };
    case "SET_GRID_SIZE":
      return { ...state, gridSize: action.size };
    case "RESET":
      return INITIAL_EDITOR_STATE;
    case "LOAD_STATE":
      return { ...state, ...action.state };
    default:
      return state;
  }
}

function undoReducer(undoState: UndoableState, action: EditorAction): UndoableState {
  if (action.type === "UNDO") {
    if (undoState.history.length === 0) return undoState;
    const previous = undoState.history[undoState.history.length - 1];
    // Restore previous state but keep current view settings (zoom, pan, tool, toggles)
    return {
      current: {
        ...previous,
        tool: undoState.current.tool,
        zoom: undoState.current.zoom,
        panOffset: undoState.current.panOffset,
        snapToGrid: undoState.current.snapToGrid,
        showDimensions: undoState.current.showDimensions,
        showAngles: undoState.current.showAngles,
        gridSize: undoState.current.gridSize,
      },
      history: undoState.history.slice(0, -1),
    };
  }

  const newState = editorReducer(undoState.current, action);

  // Only push to history for undoable actions
  if (UNDOABLE_ACTIONS.has(action.type)) {
    const newHistory = [...undoState.history, undoState.current].slice(-MAX_UNDO_HISTORY);
    return { current: newState, history: newHistory };
  }

  return { current: newState, history: undoState.history };
}

type EditorContextType = {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  canUndo: boolean;
};

// eslint-disable-next-line react-refresh/only-export-components
const EditorContext = createContext<EditorContextType | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [undoState, rawDispatch] = useReducer(undoReducer, {
    current: INITIAL_EDITOR_STATE,
    history: [],
  });

  const canUndo = undoState.history.length > 0;

  const value = React.useMemo(
    () => ({ state: undoState.current, dispatch: rawDispatch, canUndo }),
    [undoState, canUndo]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}
