import { supabase } from "@/integrations/supabase/client";

const POLYHAVEN_CDN = "https://cdn.polyhaven.com";

async function fetchPolyHaven(endpoint: string, params?: Record<string, string>) {
  const searchParams = new URLSearchParams({ endpoint, ...params });
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/polyhaven-proxy?${searchParams}`;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });

  if (!res.ok) throw new Error(`Poly Haven API error: ${res.status}`);
  return res.json();
}

export type PolyHavenAsset = {
  name: string;
  type: number;
  categories: string[];
  tags: string[];
  thumbnail_url: string;
  download_count: number;
};

export type PolyHavenTextureFiles = {
  Diffuse?: Record<string, Record<string, { url: string; size: number }>>;
  "Displacement"?: Record<string, Record<string, { url: string; size: number }>>;
  "nor_gl"?: Record<string, Record<string, { url: string; size: number }>>;
  "Rough"?: Record<string, Record<string, { url: string; size: number }>>;
  "AO"?: Record<string, Record<string, { url: string; size: number }>>;
  [key: string]: any;
};

/** Get texture categories */
export async function getTextureCategories(): Promise<Record<string, number>> {
  return fetchPolyHaven("/categories/textures");
}

/** Search textures with optional category filter */
export async function searchTextures(
  categories?: string
): Promise<Record<string, PolyHavenAsset>> {
  const params: Record<string, string> = { type: "textures" };
  if (categories) params.categories = categories;
  return fetchPolyHaven("/assets", params);
}

/** Get files for a specific texture */
export async function getTextureFiles(
  id: string
): Promise<PolyHavenTextureFiles> {
  return fetchPolyHaven(`/files/${id}`);
}

/**
 * Get direct download URLs for a texture at a given resolution.
 * Returns { diffuse, normal, roughness, ao } URLs or null if not available.
 */
export async function getTextureUrls(
  id: string,
  resolution: string = "1k"
): Promise<{
  diffuse: string | null;
  normal: string | null;
  roughness: string | null;
  ao: string | null;
}> {
  const files = await getTextureFiles(id);

  const getUrl = (mapType: string): string | null => {
    const map = files[mapType];
    if (!map) return null;
    const res = map[resolution] || map["1k"] || map["2k"];
    if (!res) return null;
    // Prefer jpg, then png, then exr
    return res.jpg?.url || res.png?.url || (Object.values(res)[0] as any)?.url || null;
  };

  return {
    diffuse: getUrl("Diffuse"),
    normal: getUrl("nor_gl"),
    roughness: getUrl("Rough"),
    ao: getUrl("AO"),
  };
}

/** Categories relevant to arcade/entertainment space floors */
export const FLOOR_CATEGORIES = [
  "floor", "concrete", "carpet", "wood", "tile", "asphalt", "stone",
];

/** Categories relevant to walls */
export const WALL_CATEGORIES = [
  "brick", "concrete", "wood", "plaster", "metal", "stone", "paint",
];

/** Categories relevant to ceilings */
export const CEILING_CATEGORIES = [
  "concrete", "metal", "wood", "plaster",
];
