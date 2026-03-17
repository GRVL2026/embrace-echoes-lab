const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SKETCHFAB_API = "https://api.sketchfab.com/v3";

/**
 * Sketchfab proxy Edge Function
 * 
 * Endpoints (via `action` body param):
 *   - search:   Search models with structured query
 *   - details:  Get model details by UID
 *   - download: Get download URL for a model (requires downloadable license)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const token = Deno.env.get("SKETCHFAB_API_TOKEN");
  if (!token) {
    return new Response(
      JSON.stringify({ error: "SKETCHFAB_API_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const headers = {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "search") {
      return await handleSearch(body, headers);
    } else if (action === "details") {
      return await handleDetails(body, headers);
    } else if (action === "download") {
      return await handleDownload(body, headers);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.error("sketchfab-proxy error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Search ─────────────────────────────────────────────────
async function handleSearch(
  body: { query?: string; categories?: string; tags?: string[]; downloadable?: boolean; animated?: boolean; max_results?: number },
  headers: Record<string, string>
) {
  const params = new URLSearchParams();
  params.set("type", "models");
  if (body.query) params.set("q", body.query);
  if (body.downloadable !== false) params.set("downloadable", "true");
  if (body.animated !== undefined) params.set("animated", String(body.animated));
  if (body.categories) params.set("categories", body.categories);
  if (body.tags?.length) params.set("tags", body.tags.join(","));
  params.set("count", String(Math.min(body.max_results || 24, 48)));
  // Sort by relevance
  params.set("sort_by", "-relevance");

  const resp = await fetch(`${SKETCHFAB_API}/search?${params}`, { headers });
  if (!resp.ok) {
    const t = await resp.text();
    console.error("Sketchfab search error:", resp.status, t);
    return new Response(
      JSON.stringify({ error: `Sketchfab API error: ${resp.status}` }),
      { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const data = await resp.json();
  // Normalize results
  const results = (data.results || []).map((m: any) => ({
    uid: m.uid,
    name: m.name,
    description: m.description?.substring(0, 200),
    thumbnail: m.thumbnails?.images?.[0]?.url,
    vertex_count: m.vertexCount,
    face_count: m.faceCount,
    is_downloadable: m.isDownloadable,
    license: m.license?.slug,
    tags: m.tags?.map((t: any) => t.name) || [],
    user: m.user?.displayName,
    view_count: m.viewCount,
    like_count: m.likeCount,
  }));

  return new Response(
    JSON.stringify({ results, total: data.totalCount || results.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─── Details ────────────────────────────────────────────────
async function handleDetails(
  body: { uid: string },
  headers: Record<string, string>
) {
  if (!body.uid) {
    return new Response(
      JSON.stringify({ error: "Missing uid" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const resp = await fetch(`${SKETCHFAB_API}/models/${body.uid}`, { headers });
  if (!resp.ok) {
    const t = await resp.text();
    return new Response(
      JSON.stringify({ error: `Sketchfab error: ${resp.status}` }),
      { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const m = await resp.json();
  return new Response(
    JSON.stringify({
      uid: m.uid,
      name: m.name,
      description: m.description,
      thumbnail: m.thumbnails?.images?.[0]?.url,
      vertex_count: m.vertexCount,
      face_count: m.faceCount,
      is_downloadable: m.isDownloadable,
      license: m.license?.slug,
      tags: m.tags?.map((t: any) => t.name) || [],
      user: m.user?.displayName,
      archives: m.archives,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─── Download ───────────────────────────────────────────────
async function handleDownload(
  body: { uid: string },
  headers: Record<string, string>
) {
  if (!body.uid) {
    return new Response(
      JSON.stringify({ error: "Missing uid" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const resp = await fetch(`${SKETCHFAB_API}/models/${body.uid}/download`, { headers });
  if (!resp.ok) {
    const t = await resp.text();
    console.error("Sketchfab download error:", resp.status, t);

    if (resp.status === 403) {
      return new Response(
        JSON.stringify({ error: "Model not downloadable or insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: `Sketchfab download error: ${resp.status}` }),
      { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const data = await resp.json();

  // Prefer glb, then gltf
  const glb = data.glb || data.gltf;
  const result: any = {};

  if (glb) {
    result.download_url = glb.url;
    result.format = data.glb ? "glb" : "gltf";
    result.size = glb.size;
    result.expires = glb.expires;
  }

  // Also include other available formats
  result.available_formats = Object.keys(data);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
