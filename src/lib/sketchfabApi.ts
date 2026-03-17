import { supabase } from "@/integrations/supabase/client";

export interface SketchfabModel {
  uid: string;
  name: string;
  description?: string;
  thumbnail?: string;
  vertex_count?: number;
  face_count?: number;
  is_downloadable?: boolean;
  license?: string;
  tags?: string[];
  user?: string;
  view_count?: number;
  like_count?: number;
}

export interface SketchfabSearchResult {
  results: SketchfabModel[];
  total: number;
}

export interface SketchfabDownloadResult {
  download_url?: string;
  format?: string;
  size?: number;
  expires?: number;
  available_formats?: string[];
  error?: string;
}

/** Search Sketchfab models via the proxy edge function */
export async function searchSketchfab(params: {
  query: string;
  tags?: string[];
  downloadable?: boolean;
  animated?: boolean;
  max_results?: number;
}): Promise<SketchfabSearchResult> {
  const { data, error } = await supabase.functions.invoke("sketchfab-proxy", {
    body: { action: "search", ...params },
  });
  if (error) throw new Error(error.message || "Erreur de recherche Sketchfab");
  if (data?.error) throw new Error(data.error);
  return data as SketchfabSearchResult;
}

/** Get model details by UID */
export async function getSketchfabDetails(uid: string): Promise<SketchfabModel> {
  const { data, error } = await supabase.functions.invoke("sketchfab-proxy", {
    body: { action: "details", uid },
  });
  if (error) throw new Error(error.message || "Erreur Sketchfab details");
  if (data?.error) throw new Error(data.error);
  return data as SketchfabModel;
}

/** Get download URL for a model */
export async function getSketchfabDownload(uid: string): Promise<SketchfabDownloadResult> {
  const { data, error } = await supabase.functions.invoke("sketchfab-proxy", {
    body: { action: "download", uid },
  });
  if (error) throw new Error(error.message || "Erreur Sketchfab download");
  if (data?.error) throw new Error(data.error);
  return data as SketchfabDownloadResult;
}
