import { supabase } from "@/integrations/supabase/client";
import type { CopilotAction } from "@/types/copilot";

export interface CopilotChatRequest {
  messages: Array<{
    role: "user" | "assistant";
    text?: string;
    images?: string[];
  }>;
  session_id?: string;
  links?: string[];
}

export interface CopilotChatResponse {
  text: string;
  actions: CopilotAction[];
  summary: string;
  alternatives: string[];
  error?: string;
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
