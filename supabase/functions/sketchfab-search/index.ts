import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SKETCHFAB_API = "https://api.sketchfab.com/v3";

// ─── Types ──────────────────────────────────────────────────

interface DesignContext {
  style_profile: {
    primary: string;
    secondary: string[];
    palette: string[];
    materials?: string[];
    mood?: string[];
  };
  search_plan: Array<{
    category: string;
    queries: string[];
    max_candidates: number;
  }>;
  negative_filters: string[];
  placement_rules: Record<string, string>;
}

interface ScoredResult {
  uid: string;
  name: string;
  description?: string;
  thumbnail?: string;
  vertex_count: number;
  face_count: number;
  is_downloadable: boolean;
  license?: string;
  tags: string[];
  user?: string;
  category: string;
  score: number;
  score_breakdown: Record<string, number>;
}

// ─── Constants ──────────────────────────────────────────────

const MAX_POLYCOUNT = 150_000; // web-medium tier
const COMPATIBLE_LICENSES = ["cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa"];

// ─── Scoring weights ────────────────────────────────────────

const WEIGHTS = {
  semantic_relevance: 0.35,
  style_compatibility: 0.20,
  palette_material: 0.15,
  arcade_relevance: 0.10,
  performance: 0.10,
  cohesion: 0.10,
};

// ─── Main handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, design_context, existing_asset_ids } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const SKETCHFAB_TOKEN = Deno.env.get("SKETCHFAB_API_TOKEN");
    if (!SKETCHFAB_TOKEN) throw new Error("SKETCHFAB_API_TOKEN not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Layer 1: Intent extraction (if raw prompt, not pre-parsed) ──
    let context: DesignContext;
    if (design_context) {
      context = design_context;
    } else if (prompt) {
      context = await extractIntent(prompt, LOVABLE_API_KEY);
    } else {
      return errorResponse(400, "Missing prompt or design_context");
    }

    // ── Layer 1.5: Check curated assets first (Mode A) ──
    const curatedResults = await searchCuratedAssets(supabase, context);

    // Determine which categories still need Sketchfab discovery
    const coveredCategories = new Set(curatedResults.map((r) => r.category));
    const uncoveredPlan = context.search_plan.filter(
      (sp) => !coveredCategories.has(sp.category) || 
        curatedResults.filter((r) => r.category === sp.category).length < 2
    );

    // ── Layer 2: Sketchfab search (Mode B — discovery) ──
    let sketchfabResults: ScoredResult[] = [];
    if (uncoveredPlan.length > 0) {
      const rawResults = await searchSketchfab(uncoveredPlan, SKETCHFAB_TOKEN);

      // ── Layer 3: Filter & Score ──
      const filtered = filterResults(rawResults, context.negative_filters);
      sketchfabResults = scoreResults(filtered, context);
    }

    // ── Merge curated + discovery, pick top per category ──
    const allResults = [...curatedResults, ...sketchfabResults];
    const selected = selectTopPerCategory(allResults, context.search_plan);

    // ── Layer 4: Download & Import selected Sketchfab assets ──
    const importedAssets = [];
    for (const asset of selected) {
      if (asset.uid.startsWith("curated-")) {
        importedAssets.push(asset);
        continue;
      }
      try {
        const imported = await downloadAndImport(asset, SKETCHFAB_TOKEN, supabase);
        if (imported) importedAssets.push({ ...asset, ...imported });
      } catch (e) {
        console.error(`Failed to import ${asset.uid}:`, e);
      }
    }

    return new Response(
      JSON.stringify({
        design_context: context,
        curated_count: curatedResults.length,
        discovery_count: sketchfabResults.length,
        selected: importedAssets,
        placement_rules: context.placement_rules,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sketchfab-search error:", e);
    return errorResponse(500, e instanceof Error ? e.message : "Unknown error");
  }
});

// ─── Layer 1: Intent Extraction via LLM ─────────────────────

async function extractIntent(prompt: string, apiKey: string): Promise<DesignContext> {
  const systemPrompt = `Tu es un assistant de direction artistique pour un configurateur de salle d'arcade.
Tu dois transformer chaque demande en un plan de recherche structuré.
Tu ne dois jamais inventer d'asset inexistant.
Tu dois privilégier les assets compatibles web, cohérents avec une salle commerciale.
Tu dois éviter les assets trop lourds, incohérents d'échelle, hors contexte, ou redondants.
Tu dois préférer quelques assets cohérents à beaucoup d'assets médiocres.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "generate_search_plan",
          description: "Generate a structured search plan for 3D assets based on the user's design request",
          parameters: {
            type: "object",
            properties: {
              style_profile: {
                type: "object",
                properties: {
                  primary: { type: "string", description: "Primary style e.g. 'futuristic arcade'" },
                  secondary: { type: "array", items: { type: "string" } },
                  palette: { type: "array", items: { type: "string" }, description: "Color palette" },
                  materials: { type: "array", items: { type: "string" } },
                  mood: { type: "array", items: { type: "string" } },
                },
                required: ["primary", "secondary", "palette"],
              },
              search_plan: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string", description: "Functional category: wall_decor, lighting, ceiling_elements, plants, premium_seating, signage, props, furniture" },
                    queries: { type: "array", items: { type: "string" }, description: "3-8 specialized search queries per category, using synonyms and style variants" },
                    max_candidates: { type: "number" },
                  },
                  required: ["category", "queries", "max_candidates"],
                },
              },
              negative_filters: {
                type: "array",
                items: { type: "string" },
                description: "Terms to exclude: rustic, bedroom, kitchen, farmhouse, medieval, realistic weapon, etc.",
              },
              placement_rules: {
                type: "object",
                description: "Mapping of category to placement rule: walls only, ceiling, corners, center, etc.",
              },
            },
            required: ["style_profile", "search_plan", "negative_filters", "placement_rules"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "generate_search_plan" } },
      stream: false,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Intent extraction error:", resp.status, t);
    throw new Error(`Intent extraction failed: ${resp.status}`);
  }

  const data = await resp.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) throw new Error("No tool call in intent extraction response");

  return JSON.parse(tc.function.arguments) as DesignContext;
}

// ─── Layer 1.5: Curated assets search ───────────────────────

async function searchCuratedAssets(supabase: any, context: DesignContext): Promise<ScoredResult[]> {
  const results: ScoredResult[] = [];

  for (const plan of context.search_plan) {
    // Build a broader search: category/subcategory + style_tags + material_tags + room_tags + description
    const searchTerms = [
      plan.category,
      ...plan.queries.slice(0, 3), // Use first queries as search terms
    ];
    const styleTerms = context.style_profile.secondary.slice(0, 3);
    const moodTerms = (context.style_profile.mood || []).slice(0, 2);

    // Build OR filter across multiple metadata columns
    const orFilters = [
      `category.ilike.%${plan.category}%`,
      `subcategory.ilike.%${plan.category}%`,
      ...searchTerms.flatMap((term) => [
        `name.ilike.%${term}%`,
        `description.ilike.%${term}%`,
      ]),
    ].join(",");

    const { data } = await supabase
      .from("copilot_assets")
      .select("*")
      .eq("is_active", true)
      .eq("is_curated", true)
      .or(orFilters)
      .limit(15);

    if (data) {
      for (const asset of data) {
        const styleTags = (asset.style_tags || []).map((t: string) => t.toLowerCase());
        const materialTags = (asset.material_tags || []).map((t: string) => t.toLowerCase());
        const colorTags = (asset.color_tags || []).map((t: string) => t.toLowerCase());
        const roomTags = (asset.room_tags || []).map((t: string) => t.toLowerCase());
        const descLower = (asset.description || "").toLowerCase();
        const nameLower = (asset.name || "").toLowerCase();

        const allAssetText = [...styleTags, ...materialTags, ...colorTags, ...roomTags, nameLower, descLower];

        // Style match: check across all metadata, not just style_tags
        const styleHits = [...context.style_profile.secondary, ...moodTerms].filter((s) =>
          allAssetText.some((t) => t.includes(s.toLowerCase()))
        ).length;

        // Material match
        const matHits = (context.style_profile.materials || []).filter((m) =>
          allAssetText.some((t) => t.includes(m.toLowerCase()))
        ).length;

        // Palette match
        const paletteHits = context.style_profile.palette.filter((p) =>
          allAssetText.some((t) => t.includes(p.toLowerCase()))
        ).length;

        // Category relevance: check query terms against all asset text
        const queryHits = plan.queries.filter((q) => {
          const words = q.toLowerCase().split(/\s+/);
          return words.some((w) => allAssetText.some((t) => t.includes(w)));
        }).length;

        const totalSignals = styleHits + matHits + paletteHits + queryHits;
        const maxSignals = context.style_profile.secondary.length + moodTerms.length +
          (context.style_profile.materials || []).length + context.style_profile.palette.length + plan.queries.length;

        const relevanceScore = Math.min(totalSignals / Math.max(maxSignals, 1), 1);
        const curatedBonus = 0.2;
        const finalScore = Math.min(relevanceScore * 0.8 + curatedBonus, 1);

        results.push({
          uid: `curated-${asset.id}`,
          name: asset.name,
          description: asset.description,
          thumbnail: asset.thumbnail_url,
          vertex_count: asset.polycount || 0,
          face_count: asset.polycount || 0,
          is_downloadable: true,
          license: asset.license,
          tags: asset.style_tags || [],
          category: plan.category,
          score: finalScore,
          score_breakdown: {
            curated_bonus: curatedBonus,
            style_hits: styleHits,
            material_hits: matHits,
            palette_hits: paletteHits,
            query_hits: queryHits,
            relevance: relevanceScore,
          },
        });
      }
    }
  }

  return results;
}

// ─── Layer 2: Sketchfab parallel search ─────────────────────

async function searchSketchfab(
  searchPlan: DesignContext["search_plan"],
  token: string
): Promise<(ScoredResult & { _raw_tags: string[] })[]> {
  const allResults: (ScoredResult & { _raw_tags: string[] })[] = [];

  // Parallel search per category
  const searchPromises = searchPlan.flatMap((plan) =>
    plan.queries.map(async (query) => {
      const params = new URLSearchParams({
        type: "models",
        q: query,
        downloadable: "true",
        sort_by: "-relevance",
        count: String(Math.min(plan.max_candidates || 12, 24)),
      });

      try {
        const resp = await fetch(`${SKETCHFAB_API}/search?${params}`, {
          headers: { Authorization: `Token ${token}` },
        });

        if (!resp.ok) {
          const t = await resp.text();
          console.error(`Search failed for "${query}":`, resp.status, t);
          return [];
        }

        const data = await resp.json();
        return (data.results || []).map((m: any) => ({
          uid: m.uid,
          name: m.name,
          description: m.description?.substring(0, 200),
          thumbnail: m.thumbnails?.images?.[0]?.url,
          vertex_count: m.vertexCount || 0,
          face_count: m.faceCount || 0,
          is_downloadable: m.isDownloadable,
          license: m.license?.slug,
          tags: m.tags?.map((t: any) => t.name) || [],
          _raw_tags: m.tags?.map((t: any) => t.name.toLowerCase()) || [],
          user: m.user?.displayName,
          category: plan.category,
          score: 0,
          score_breakdown: {},
        }));
      } catch (e) {
        console.error(`Search error for "${query}":`, e);
        return [];
      }
    })
  );

  const results = await Promise.all(searchPromises);
  const seen = new Set<string>();
  for (const batch of results) {
    for (const item of batch) {
      if (!seen.has(item.uid)) {
        seen.add(item.uid);
        allResults.push(item);
      }
    }
  }

  return allResults;
}

// ─── Layer 3: Filtering ─────────────────────────────────────

function filterResults(
  results: (ScoredResult & { _raw_tags: string[] })[],
  negativeFilters: string[]
): (ScoredResult & { _raw_tags: string[] })[] {
  const negLower = negativeFilters.map((n) => n.toLowerCase());

  return results.filter((r) => {
    // Must be downloadable
    if (!r.is_downloadable) return false;

    // License check
    if (r.license && !COMPATIBLE_LICENSES.includes(r.license)) return false;

    // Polycount check (web performance)
    if (r.vertex_count > MAX_POLYCOUNT) return false;

    // Negative filter on tags + name
    const nameLower = r.name.toLowerCase();
    const descLower = (r.description || "").toLowerCase();
    for (const neg of negLower) {
      if (nameLower.includes(neg)) return false;
      if (descLower.includes(neg)) return false;
      if (r._raw_tags.some((t) => t.includes(neg))) return false;
    }

    return true;
  });
}

// ─── Layer 3: Scoring ───────────────────────────────────────

/** Check if any term matches in a set of text fields */
function matchesAny(term: string, ...fields: string[]): boolean {
  return fields.some((f) => f.includes(term));
}

function scoreResults(
  results: (ScoredResult & { _raw_tags: string[] })[],
  context: DesignContext
): ScoredResult[] {
  const styleTags = [
    context.style_profile.primary.toLowerCase(),
    ...context.style_profile.secondary.map((s) => s.toLowerCase()),
  ];
  const moodTags = (context.style_profile.mood || []).map((m) => m.toLowerCase());
  const paletteTags = context.style_profile.palette.map((p) => p.toLowerCase());
  const materialTags = (context.style_profile.materials || []).map((m) => m.toLowerCase());
  const arcadeTerms = ["arcade", "gaming", "entertainment", "commercial", "retail", "amusement", "game room", "fun", "neon"];

  // Build expanded search terms from query plans for the category
  const categoryQueryMap: Record<string, string[]> = {};
  for (const sp of context.search_plan) {
    categoryQueryMap[sp.category] = sp.queries.flatMap((q) =>
      q.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    );
  }

  return results.map((r) => {
    const tags = r._raw_tags;
    const nameLower = r.name.toLowerCase();
    const descLower = (r.description || "").toLowerCase();
    const allTagsJoined = tags.join(" ");

    // ── Semantic relevance: category words + query terms against name, description, tags
    const categoryWords = r.category.replace(/_/g, " ").split(" ").filter((w) => w.length > 2);
    const queryWords = categoryQueryMap[r.category] || [];
    const allSemanticTerms = [...new Set([...categoryWords, ...queryWords])];

    const semanticHits = allSemanticTerms.filter(
      (w) => matchesAny(w, nameLower, descLower, allTagsJoined)
    ).length;
    const semantic = Math.min(semanticHits / Math.max(allSemanticTerms.length * 0.3, 1), 1);

    // ── Style compatibility: check style + mood against all text fields
    const allStyleTerms = [...styleTags, ...moodTags];
    const styleHits = allStyleTerms.filter(
      (s) => matchesAny(s, nameLower, descLower, allTagsJoined)
    ).length;
    const style = Math.min(styleHits / Math.max(allStyleTerms.length * 0.4, 1), 1);

    // ── Palette & material: check against all text fields
    const paletteHits = paletteTags.filter(
      (p) => matchesAny(p, nameLower, descLower, allTagsJoined)
    ).length;
    const matHits = materialTags.filter(
      (m) => matchesAny(m, nameLower, descLower, allTagsJoined)
    ).length;
    const totalPaletteMatTerms = paletteTags.length + materialTags.length;
    const paletteMat = Math.min(
      (paletteHits + matHits) / Math.max(totalPaletteMatTerms * 0.3, 1),
      1
    );

    // ── Arcade relevance: check against all text fields
    const arcadeHits = arcadeTerms.filter(
      (a) => matchesAny(a, nameLower, descLower, allTagsJoined)
    ).length;
    const arcade = Math.min(arcadeHits / 2, 1);

    // ── Performance (lower polycount = better)
    const perf = r.vertex_count <= 10_000 ? 1 : r.vertex_count <= 50_000 ? 0.7 : r.vertex_count <= 100_000 ? 0.4 : 0.2;

    // ── Cohesion: combines style match + semantic match for a holistic signal
    const cohesion = (style > 0.3 && semantic > 0.2) ? 0.8 : style > 0.2 ? 0.5 : 0.2;

    const totalScore =
      semantic * WEIGHTS.semantic_relevance +
      style * WEIGHTS.style_compatibility +
      paletteMat * WEIGHTS.palette_material +
      arcade * WEIGHTS.arcade_relevance +
      perf * WEIGHTS.performance +
      cohesion * WEIGHTS.cohesion;

    return {
      ...r,
      score: totalScore,
      score_breakdown: {
        semantic,
        style,
        palette_material: paletteMat,
        arcade,
        performance: perf,
        cohesion,
      },
    };
  }).sort((a, b) => b.score - a.score);
}

// ─── Select top per category ────────────────────────────────

function selectTopPerCategory(
  results: ScoredResult[],
  searchPlan: DesignContext["search_plan"]
): ScoredResult[] {
  const selected: ScoredResult[] = [];
  const maxPerCategory = 3;

  for (const plan of searchPlan) {
    const categoryResults = results
      .filter((r) => r.category === plan.category)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerCategory);
    selected.push(...categoryResults);
  }

  return selected;
}

// ─── Layer 4: Download & Import ─────────────────────────────

async function downloadAndImport(
  asset: ScoredResult,
  sketchfabToken: string,
  supabase: any
): Promise<{ glb_url: string; asset_db_id: string } | null> {
  // Check if already imported
  const { data: existing } = await supabase
    .from("external_asset_sources")
    .select("id")
    .eq("provider", "sketchfab")
    .eq("provider_asset_id", asset.uid)
    .maybeSingle();

  if (existing) {
    // Already imported, find the copilot_asset
    const { data: ca } = await supabase
      .from("copilot_assets")
      .select("id, file_url")
      .eq("provider_asset_id", asset.uid)
      .maybeSingle();
    if (ca) return { glb_url: ca.file_url, asset_db_id: ca.id };
  }

  // Get download URL
  const dlResp = await fetch(`${SKETCHFAB_API}/models/${asset.uid}/download`, {
    headers: { Authorization: `Token ${sketchfabToken}` },
  });

  if (!dlResp.ok) {
    const t = await dlResp.text();
    console.error(`Download API error for ${asset.uid}:`, dlResp.status, t);
    return null;
  }

  const dlData = await dlResp.json();
  const glbInfo = dlData.glb || dlData.gltf;
  if (!glbInfo?.url) {
    console.error(`No GLB/glTF download for ${asset.uid}`);
    return null;
  }

  // Download the file
  const fileResp = await fetch(glbInfo.url);
  if (!fileResp.ok) return null;
  const fileBlob = await fileResp.blob();
  const fileSize = fileBlob.size / (1024 * 1024); // MB

  // Upload to storage bucket
  const fileName = `sketchfab/${asset.uid}.glb`;
  const { error: uploadErr } = await supabase.storage
    .from("models-3d")
    .upload(fileName, fileBlob, {
      contentType: "model/gltf-binary",
      upsert: true,
    });

  if (uploadErr) {
    console.error(`Storage upload error for ${asset.uid}:`, uploadErr);
    return null;
  }

  const { data: urlData } = supabase.storage.from("models-3d").getPublicUrl(fileName);
  const publicUrl = urlData.publicUrl;

  // Record in external_asset_sources
  await supabase.from("external_asset_sources").upsert({
    provider: "sketchfab",
    provider_asset_id: asset.uid,
    provider_url: `https://sketchfab.com/3d-models/${asset.uid}`,
    license_type: asset.license,
    download_format: "glb",
    original_metadata: {
      name: asset.name,
      vertex_count: asset.vertex_count,
      face_count: asset.face_count,
      tags: asset.tags,
      user: asset.user,
      score: asset.score,
      score_breakdown: asset.score_breakdown,
    },
    source_user: asset.user,
  }, { onConflict: "provider,provider_asset_id" });

  // Record in copilot_assets
  const performanceTier = asset.vertex_count <= 20_000 ? "light" : asset.vertex_count <= 80_000 ? "medium" : "heavy";

  const { data: insertedAsset } = await supabase.from("copilot_assets").insert({
    name: asset.name,
    description: asset.description,
    category: asset.category,
    asset_type: asset.category.includes("light") ? "lighting" : asset.category.includes("wall") ? "wall_decor" : "decor",
    format: "glb",
    style_tags: asset.tags.slice(0, 10),
    file_url: publicUrl,
    thumbnail_url: asset.thumbnail,
    source: "sketchfab",
    source_provider: "sketchfab",
    provider_asset_id: asset.uid,
    license: asset.license || "unknown",
    performance_tier: performanceTier,
    polycount: asset.vertex_count,
    file_size_mb: Math.round(fileSize * 100) / 100,
    license_ok: COMPATIBLE_LICENSES.includes(asset.license || ""),
    is_curated: false,
    is_active: true,
  }).select("id").single();

  return {
    glb_url: publicUrl,
    asset_db_id: insertedAsset?.id || "",
  };
}

// ─── Helpers ────────────────────────────────────────────────

function errorResponse(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
