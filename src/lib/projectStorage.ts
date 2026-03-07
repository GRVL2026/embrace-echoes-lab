import type { EditorState } from "@/types/editor";
import type { GameEquipment } from "@/types/equipment";

export type SavedProject = {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Serializable subset of EditorState (no tool/zoom/pan) */
  plan: {
    rooms: EditorState["rooms"];
    doors: EditorState["doors"];
    pillars: EditorState["pillars"];
    placedEquipments: EditorState["placedEquipments"];
    gridSize: EditorState["gridSize"];
  };
  catalog: GameEquipment[];
};

const STORAGE_KEY = "space-planner-projects";

function readAll(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(projects: SavedProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function listProjects(): SavedProject[] {
  return readAll().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getProject(id: string): SavedProject | undefined {
  return readAll().find((p) => p.id === id);
}

export function saveProject(project: SavedProject): void {
  const all = readAll();
  const idx = all.findIndex((p) => p.id === project.id);
  project.updatedAt = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = project;
  } else {
    all.push(project);
  }
  writeAll(all);
}

export function deleteProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

export function createNewProject(
  name: string,
  state: EditorState,
  catalog: GameEquipment[],
  notes = ""
): SavedProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    notes,
    createdAt: now,
    updatedAt: now,
    plan: {
      rooms: state.rooms,
      doors: state.doors,
      pillars: state.pillars,
      placedEquipments: state.placedEquipments,
      gridSize: state.gridSize,
    },
    catalog,
  };
}
