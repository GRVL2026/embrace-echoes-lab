import React, { createContext, useContext, useReducer, type ReactNode } from "react";
import { type EditorState, type EditorTool, type Point, type Room, type Door, INITIAL_EDITOR_STATE } from "@/types/editor";

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
  | { type: "TOGGLE_SNAP" }
  | { type: "TOGGLE_DIMENSIONS" }
  | { type: "SET_GRID_SIZE"; size: number }
  | { type: "RESET" };

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
      // Re-index doors on this room
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
    case "DELETE_DOOR":
      return { ...state, doors: state.doors.filter((d) => d.id !== action.id) };
    case "TOGGLE_SNAP":
      return { ...state, snapToGrid: !state.snapToGrid };
    case "TOGGLE_DIMENSIONS":
      return { ...state, showDimensions: !state.showDimensions };
    case "SET_GRID_SIZE":
      return { ...state, gridSize: action.size };
    case "RESET":
      return INITIAL_EDITOR_STATE;
    default:
      return state;
  }
}

type EditorContextType = {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
};

const EditorContext = createContext<EditorContextType | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE);
  return <EditorContext.Provider value={{ state, dispatch }}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}
