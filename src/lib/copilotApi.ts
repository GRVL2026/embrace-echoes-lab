import { supabase } from "@/integrations/supabase/client";
import type { CopilotAction } from "@/types/copilot";

export interface RoomContext {
  walls: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>;
  doors: Array<{ position: { x: number; y: number }; width: number; isMain?: boolean }>;
  pillars: Array<{ position: { x: number; y: number }; width: number; depth: number }>;
  floor_points: Array<{ x: number; y: number }>;
  room_width_cm: number;
  room_depth_cm: number;
  room_height_cm: number;
  existing_equipment: Array<{
    name: string;
    position: { x: number; y: number };
    width: number;
    depth: number;
    rotation: number;
  }>;
  circulation_width_cm: number;
}

export interface CopilotChatRequest {
  messages: Array<{
    role: "user" | "assistant";
    text?: string;
    images?: string[];
  }>;
  session_id?: string;
  links?: string[];
  room_context?: RoomContext;
}

export interface PendingAssetData {
  asset_id: string;
  asset_name: string;
  glb_url?: string;
  category?: string;
  thumbnail?: string;
  placement_rule?: string;
  score?: number;
  source?: "curated" | "discovery";
  polycount?: number;
  file_size_mb?: number;
}

export interface CopilotChatResponse {
  text: string;
  actions: CopilotAction[];
  summary: string;
  alternatives: string[];
  error?: string;
  pending_assets?: PendingAssetData[];
  asset_search?: {
    curated_count: number;
    discovery_count: number;
    selected_count: number;
    placement_rules?: Record<string, string>;
  };
}

export async function sendCopilotMessage(req: CopilotChatRequest): Promise<CopilotChatResponse> {
  const { data, error } = await supabase.functions.invoke("copilot-chat", {
    body: req,
  });

  if (error) {
    throw new Error(error.message || "Erreur de communication avec le copilote");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as CopilotChatResponse;
}

export async function createSession(): Promise<string> {
  const { data, error } = await supabase
    .from("prompt_sessions")
    .insert({ messages: [], status: "active" })
    .select("id")
    .single();

  if (error) throw new Error("Impossible de créer la session");
  return data.id;
}

export async function loadSession(sessionId: string) {
  const { data, error } = await supabase
    .from("prompt_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error) throw error;
  return data;
}
