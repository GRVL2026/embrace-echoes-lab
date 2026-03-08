import { useEffect, useRef } from "react";
import type { EditorState } from "@/types/editor";
import type { GameEquipment } from "@/types/equipment";

const AUTOSAVE_KEY = "space-planner-autosave";
const DEBOUNCE_MS = 500;

export type AutoSaveData = {
  plan: {
    rooms: EditorState["rooms"];
    doors: EditorState["doors"];
    pillars: EditorState["pillars"];
    placedEquipments: EditorState["placedEquipments"];
    gridSize: EditorState["gridSize"];
    circulationPath: EditorState["circulationPath"];
  };
  catalog: GameEquipment[];
  savedAt: string;
};

export function saveSession(state: EditorState, catalog: GameEquipment[]) {
  const data: AutoSaveData = {
    plan: {
      rooms: state.rooms,
      doors: state.doors,
      pillars: state.pillars,
      placedEquipments: state.placedEquipments,
      gridSize: state.gridSize,
      circulationPath: state.circulationPath,
    },
    catalog,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

export function loadSession(): AutoSaveData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AutoSaveData;
    // Basic validation
    if (data.plan && Array.isArray(data.plan.rooms)) return data;
    return null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

/**
 * Auto-saves editor state + catalog to localStorage on every change (debounced).
 */
export function useAutoSave(state: EditorState, catalog: GameEquipment[]) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't save empty/initial states
    if (state.rooms.length === 0 && state.placedEquipments.length === 0 && catalog.length === 0) {
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveSession(state, catalog);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.rooms, state.doors, state.pillars, state.placedEquipments, state.gridSize, state.circulationPath, catalog]);
}
