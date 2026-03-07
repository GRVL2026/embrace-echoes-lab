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
      return { ...state, rooms: state.rooms.filter((r) => r.id !== action.id) };
    case "DELETE_WALL": {
      const room = state.rooms.find((r) => r.id === action.roomId);
      if (!room) return state;
      // Remove the point at edgeIndex (collapses that edge)
      const newPoints = room.points.filter((_, i) => i !== action.edgeIndex);
      // If fewer than 3 points remain, delete the entire room
      if (newPoints.length < 3) {
        return { ...state, rooms: state.rooms.filter((r) => r.id !== action.roomId) };
      }
      return {
        ...state,
        rooms: state.rooms.map((r) =>
          r.id === action.roomId ? { ...r, points: newPoints } : r
        ),
      };
    }
    case "ADD_DOOR":
      return { ...state, doors: [...state.doors, action.door] };
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
