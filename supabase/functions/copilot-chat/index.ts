import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── System prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un assistant IA V2 expert en aménagement de salles d'arcade, de loisirs et de divertissement.
Tu aides l'utilisateur à choisir l'ambiance, les matériaux, les textures, l'éclairage et les objets décoratifs de sa salle.

Ton rôle est d'analyser les demandes (texte, images, liens web) et de proposer des modifications concrètes via des APPELS D'OUTILS (tool calls).

## NOUVEAUTÉ V2 — PLACEMENT SPATIAL INTELLIGENT

Tu reçois un contexte spatial de la salle (room_context) avec les murs, portes, poteaux, dimensions et équipements existants.
Tu DOIS utiliser ce contexte pour positionner les assets de manière logique et réaliste.

### RÈGLES DE PLACEMENT PAR TYPE D'ASSET

1. **OBJETS MURAUX** (placement_surface: "wall") — Tableaux, posters, néons, enseignes, horloges, étagères, appliques :
   - Doivent être placés CONTRE un mur
   - Position X/Z = coordonnées du point sur le mur (interpolation entre start et end)
   - wall_height = hauteur depuis le sol (typiquement 150-220cm pour les décorations murales)
   - wall_index = index du mur dans le tableau walls[]
   - Rotation Y = angle perpendiculaire au mur (face vers l'intérieur de la salle)
   - NE PAS placer devant une porte

2. **OBJETS AU SOL** (placement_surface: "floor") — Plantes, mobilier, bornes, comptoirs, statues, tapis :
   - Position au sol, Y = 0
   - Respecter un dégagement de circulation_width_cm (120cm) par rapport aux murs occupés
   - Éviter les zones de porte (rayon = largeur_porte + 150cm)
   - Éviter les collisions avec les équipements existants (marge 50cm)
   - Les plantes et éléments déco se placent idéalement dans les COINS ou le long des murs libres

3. **OBJETS DE PLAFOND** (placement_surface: "ceiling") — Lustres, projecteurs, décorations suspendues :
   - Position au plafond, Y = room_height_cm
   - Centrer dans la pièce ou au-dessus des zones fonctionnelles
   - Éviter les zones proches des murs (marge 50cm minimum)

### CALCUL DES POSITIONS

Quand room_context est fourni :
- Les coordonnées sont en CM depuis l'origine (coin haut-gauche)
- Pour placer sur un mur i : interpoler entre walls[i].start et walls[i].end
- Pour placer au sol : choisir une zone libre (pas de chevauchement avec existing_equipment)
- Pour un coin : utiliser l'intersection de deux murs consécutifs + marge 30cm

### CONTRAINTES DE CIRCULATION
- Maintenir TOUJOURS un couloir de circulation_width_cm (typiquement 120cm) libre
- Ne JAMAIS bloquer une porte (zone d'exclusion = porte + 150cm de profondeur)
- Vérifier qu'il existe toujours un chemin libre de la porte principale vers chaque zone

## RÈGLE CRITIQUE — ROUTAGE DES SOURCES

Tu DOIS TOUJOURS répondre en utilisant au moins un appel d'outil (tool call). Ne réponds JAMAIS uniquement en texte.

### TEXTURES & MATÉRIAUX → apply_scene_changes (source: Poly Haven)
Pour tout changement de matériau (sol, mur, plafond), utilise apply_scene_changes avec un **polyhaven_id** valide.
Le système résout automatiquement les URLs de texture PBR depuis Poly Haven (diffuse, normal, roughness).

Exemples de polyhaven_id par catégorie :
- SOL BÉTON : concrete_floor_02, concrete_floor_worn_001, polished_concrete
- SOL BOIS : wood_floor_deck, hardwood_brown_planks, oak_veneer_01
- SOL CARRELAGE : large_square_tiles, hexagonal_concrete, marble_01
- SOL RÉSINE/VINYLE : rubber_tiles, plastic_roughened
- MOQUETTE : fabric_pattern_05, carpet_twill
- MUR BRIQUE : red_brick_04, brick_wall_003, medieval_blocks_02
- MUR BÉTON : concrete_wall_008, concrete_layers_02
- MUR BOIS : plywood, wood_cabinet_worn, oak_veneer_01
- MUR PEINTURE : utilise set_wall_color avec un code hex, pas apply_material
- PLAFOND : acoustic_foam, ceiling_tiles, concrete_ceiling

Utilise TOUJOURS un polyhaven_id réel de cette liste ou similaire. Ne fabrique PAS d'IDs fictifs.

### OBJETS 3D → find_3d_assets (source: Sketchfab + bibliothèque interne)
Pour tout objet physique (plantes, mobilier, néons, déco, signalétique, props), utilise find_3d_assets.
Le système cherche d'abord dans la bibliothèque interne validée, puis sur Sketchfab si nécessaire.
- Plantes, végétation, pots de fleurs → placement_surface: "floor", coins ou le long des murs
- Mobilier (chaises, tables, comptoirs, banquettes) → placement_surface: "floor"
- Éclairage décoratif (lampes au sol) → placement_surface: "floor"
- Néons, enseignes lumineuses → placement_surface: "wall"
- Décoration murale (tableaux, panneaux, posters) → placement_surface: "wall"
- Signalétique → placement_surface: "wall"
- Lustres, projecteurs → placement_surface: "ceiling"
- Props thématiques au sol → placement_surface: "floor"

### DEMANDES MIXTES → appelle LES DEUX outils
Si l'utilisateur dit "ambiance industrielle avec des plantes", appelle apply_scene_changes (béton, éclairage) ET find_3d_assets (plantes).

## Contraintes

- Réponds toujours en français
- Sois concis et précis
- Propose des combinaisons cohérentes
- Préfère quelques assets cohérents à beaucoup d'assets médiocres
- Explique brièvement tes choix de placement (ex: "plante dans le coin nord-est car c'est la zone la moins encombrée")
`;


// ─── Tool definitions ───────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "apply_scene_changes",
      description: "Apply a batch of scene modifications: materials, lighting, colors, ceiling, fog.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "List of actions to apply to the scene",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["apply_material", "apply_lighting", "set_wall_color", "set_ceiling", "set_fog"] },
                target: { type: "string", enum: ["floor", "wall", "ceiling"] },
                polyhaven_id: { type: "string", description: "Poly Haven texture ID e.g. 'concrete_floor_02', 'red_brick_04'. The system will auto-resolve PBR URLs." },
                material_id: { type: "string", description: "Alias for polyhaven_id (backward compat)" },
                material_name: { type: "string", description: "Human-readable name of the texture" },
                resolution: { type: "string", enum: ["1k", "2k", "4k"], description: "Texture resolution, default 2k" },
                preset: { type: "string", enum: ["daylight", "arcade", "showroom"] },
                color: { type: "string", description: "Hex color for set_wall_color" },
                ceiling_type: { type: "string", enum: ["none", "tiles", "beams", "black", "technical"] },
                enabled: { type: "boolean" },
                fog_color: { type: "string" },
                density: { type: "number" },
              },
              required: ["type"],
            },
          },
          summary: { type: "string", description: "Brief summary of changes in French" },
          alternatives: { type: "array", items: { type: "string" } },
        },
        required: ["actions", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_3d_assets",
      description: "Search and import 3D decorative assets for the scene. Generates a structured search plan with style profile, categories, specialized queries, and intelligent placement directives based on room context.",
      parameters: {
        type: "object",
        properties: {
          style_profile: {
            type: "object",
            properties: {
              primary: { type: "string", description: "Primary style e.g. 'futuristic arcade'" },
              secondary: { type: "array", items: { type: "string" } },
              palette: { type: "array", items: { type: "string" } },
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
                queries: { type: "array", items: { type: "string" }, description: "3-8 specialized search queries." },
                max_candidates: { type: "number", description: "Max results per query, 8-12 recommended" },
                placement_surface: { type: "string", enum: ["floor", "wall", "ceiling"], description: "Where this category of assets should be placed" },
                placement_positions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      x: { type: "number", description: "X position in cm" },
                      y: { type: "number", description: "Y position in cm (height: 0=floor)" },
                      z: { type: "number", description: "Z position in cm" },
                      rotation_y: { type: "number", description: "Rotation around Y axis in degrees" },
                      wall_index: { type: "number", description: "Wall index for wall-mounted assets" },
                      wall_height: { type: "number", description: "Height from floor in cm for wall-mounted assets" },
                    },
                  },
                  description: "Pre-calculated positions based on room context. One per asset to be placed.",
                },
              },
              required: ["category", "queries"],
            },
          },
          negative_filters: {
            type: "array",
            items: { type: "string" },
            description: "Terms to exclude: rustic, bedroom, kitchen, farmhouse, medieval, weapon, broken, etc.",
          },
          placement_rules: {
            type: "object",
            description: "Category to placement: 'walls only', 'ceiling', 'corners', 'center', 'transition zones'",
          },
          summary: { type: "string", description: "Summary of what assets are being searched for, in French. Include placement rationale." },
        },
        required: ["style_profile", "search_plan", "negative_filters", "placement_rules", "summary"],
      },
    },
  },
];

// ─── Poly Haven URL resolution ──────────────────────────────
function resolvePolyHavenUrls(polyhavenId: string, resolution: string = "2k") {
  const base = `https://dl.polyhaven.org/file/ph-assets/Textures`;
  const res = resolution || "2k";
  return {
    diffuse: `${base}/${polyhavenId}/${res}/${polyhavenId}_diff_${res}.jpg`,
    normal: `${base}/${polyhavenId}/${res}/${polyhavenId}_nor_gl_${res}.jpg`,
    roughness: `${base}/${polyhavenId}/${res}/${polyhavenId}_rough_${res}.jpg`,
  };
}

/** Enrich apply_material actions with resolved Poly Haven URLs */
function enrichMaterialActions(actions: any[]): any[] {
  return actions.map((action: any) => {
    if (action.type === "apply_material") {
      const phId = action.polyhaven_id || action.material_id;
      if (phId) {
        const urls = resolvePolyHavenUrls(phId, action.resolution);
        return {
          ...action,
          material_id: phId,
          urls,
        };
      }
    }
    return action;
  });
}

// ─── Firecrawl helper ───────────────────────────────────────
async function scrapeWebsite(url: string): Promise<string> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return `[Firecrawl non configuré — impossible d'analyser ${url}]`;

  try {
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith("http")) formattedUrl = `https://${formattedUrl}`;

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: formattedUrl, formats: ["branding", "markdown"], onlyMainContent: true }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Firecrawl error:", resp.status, t);
      return `[Erreur Firecrawl ${resp.status}]`;
    }

    const data = await resp.json();
    const branding = data.data?.branding || data.branding;
    const markdown = data.data?.markdown || data.markdown;

    let analysis = "";
    if (branding) {
      analysis += `\n## Analyse branding du site ${url}\n`;
      if (branding.colors) analysis += `Couleurs: ${JSON.stringify(branding.colors)}\n`;
      if (branding.fonts) analysis += `Polices: ${JSON.stringify(branding.fonts)}\n`;
      if (branding.colorScheme) analysis += `Schéma: ${branding.colorScheme}\n`;
    }
    if (markdown) {
      analysis += `\n## Contenu (extrait):\n${markdown.slice(0, 1500)}`;
    }
    return analysis || `[Aucun contenu extrait de ${url}]`;
  } catch (e) {
    console.error("Firecrawl scrape error:", e);
    return `[Erreur lors du scraping de ${url}]`;
  }
}

// ─── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, session_id, links, room_context } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build conversation messages
    const aiMessages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

    // If links provided, scrape and add context
    if (links && links.length > 0) {
      const analyses = await Promise.all(links.map((url: string) => scrapeWebsite(url)));
      aiMessages.push({
        role: "system",
        content: `L'utilisateur a partagé des liens web. Voici l'analyse:\n${analyses.join("\n\n---\n\n")}\n\nUtilise ces informations pour inspirer tes suggestions d'ambiance.`,
      });
    }

    // Add conversation history
    for (const msg of messages) {
      if (msg.role === "user") {
        if (msg.images && msg.images.length > 0) {
          const content: any[] = [];
          if (msg.text) content.push({ type: "text", text: msg.text });
          for (const img of msg.images) {
            content.push({
              type: "image_url",
              image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
            });
          }
          aiMessages.push({ role: "user", content });
        } else {
          aiMessages.push({ role: "user", content: msg.text || "" });
        }
      } else if (msg.role === "assistant") {
        aiMessages.push({ role: "assistant", content: msg.text || "" });
      }
    }

    // Call Lovable AI Gateway
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: aiMessages,
        tools: TOOLS,
        tool_choice: "required",
        stream: false,
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      const body = await aiResp.text();
      console.error("AI gateway error:", status, body);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Trop de requêtes, réessayez dans quelques instants." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Erreur du service IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResp.json();
    const choice = aiData.choices?.[0];

    let textResponse = choice?.message?.content || "";
    let sceneActions: any[] = [];
    let summary = "";
    let alternatives: string[] = [];
    let assetSearchResult: any = null;

    console.log("AI response finish_reason:", choice?.finish_reason);
    console.log("Tool calls count:", choice?.message?.tool_calls?.length || 0);
    console.log("Content present:", !!choice?.message?.content);

    // Parse tool calls
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        console.log("Processing tool call:", tc.function.name);
        try {
          const args = JSON.parse(tc.function.arguments);

          if (tc.function.name === "apply_scene_changes") {
            sceneActions = enrichMaterialActions(args.actions || []);
            summary = args.summary || "";
            alternatives = args.alternatives || [];
            console.log("Scene actions enriched:", sceneActions.filter((a: any) => a.type === "apply_material").length, "materials with Poly Haven URLs");
          }

          if (tc.function.name === "find_3d_assets") {
            summary = args.summary || "Recherche d'assets 3D en cours...";

            // Call the sketchfab-search orchestrator
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
            console.log("Calling sketchfab-search, SUPABASE_URL:", supabaseUrl ? "set" : "MISSING", "ANON_KEY:", anonKey ? "set" : "MISSING");
            console.log("Search plan categories:", args.search_plan?.map((s: any) => s.category).join(", "));

            const searchResp = await fetch(`${supabaseUrl}/functions/v1/sketchfab-search`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${anonKey}`,
              },
              body: JSON.stringify({
                design_context: {
                  style_profile: args.style_profile,
                  search_plan: args.search_plan,
                  negative_filters: args.negative_filters,
                  placement_rules: args.placement_rules,
                },
              }),
            });

            console.log("sketchfab-search response status:", searchResp.status);

            if (searchResp.ok) {
              assetSearchResult = await searchResp.json();
              console.log("Search results - curated:", assetSearchResult.curated_count, "discovery:", assetSearchResult.discovery_count, "selected:", assetSearchResult.selected?.length);

              // Convert selected assets to add_asset actions
              if (assetSearchResult.selected) {
                for (const asset of assetSearchResult.selected) {
                  if (asset.glb_url) {
                    sceneActions.push({
                      type: "add_asset",
                      asset_id: asset.asset_db_id || asset.uid,
                      asset_name: asset.name,
                      glb_url: asset.glb_url,
                      category: asset.category,
                      thumbnail: asset.thumbnail,
                      placement_rule: args.placement_rules?.[asset.category] || "auto",
                    });
                  }
                }
              }

              // Generate text if LLM didn't provide any (common with tool_calls)
              if (!textResponse) {
                const assetCount = sceneActions.filter((a: any) => a.type === "add_asset").length;
                textResponse = assetCount > 0
                  ? `J'ai trouvé **${assetCount} asset(s) 3D** correspondant à votre demande. Vous pouvez les prévisualiser et choisir lesquels ajouter à la scène.`
                  : `La recherche n'a pas retourné d'assets correspondants. Essayez avec une description plus précise du style souhaité.`;
              }
            } else {
              const errText = await searchResp.text();
              console.error("Sketchfab search error:", searchResp.status, errText);
              if (!textResponse) {
                textResponse = "⚠️ La recherche d'assets 3D a rencontré une erreur. Réessayez avec une description différente.";
              } else {
                textResponse += "\n\n⚠️ La recherche d'assets 3D a rencontré une erreur.";
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse tool call:", tc.function.name, e);
          if (!textResponse) {
            textResponse = "⚠️ Une erreur est survenue lors du traitement de la demande.";
          }
        }
      }
    }

    // Fallback: if no text at all after processing
    if (!textResponse && sceneActions.length === 0) {
      textResponse = "Je n'ai pas pu traiter cette demande. Pouvez-vous reformuler ou préciser votre souhait ?";
    }

    // Persist session
    if (session_id) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: session } = await supabase
          .from("prompt_sessions")
          .select("messages")
          .eq("id", session_id)
          .single();

        const existingMessages = (session?.messages as any[]) || [];
        const lastUserMsg = messages[messages.length - 1];
        const newMessages = [
          ...existingMessages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: { text: lastUserMsg?.text, images: lastUserMsg?.images, links },
            created_at: new Date().toISOString(),
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { text: textResponse },
            copilot_response: {
              summary,
              actions: sceneActions,
              alternatives,
              asset_search: assetSearchResult ? {
                curated_count: assetSearchResult.curated_count,
                discovery_count: assetSearchResult.discovery_count,
                selected_count: assetSearchResult.selected?.length || 0,
              } : null,
            },
            created_at: new Date().toISOString(),
          },
        ];

        await supabase
          .from("prompt_sessions")
          .update({ messages: newMessages, updated_at: new Date().toISOString() })
          .eq("id", session_id);
      } catch (e) {
        console.error("Session persist error:", e);
      }
    }

    return new Response(
      JSON.stringify({
        text: textResponse,
        actions: sceneActions,
        summary,
        alternatives,
        asset_search: assetSearchResult ? {
          curated_count: assetSearchResult.curated_count,
          discovery_count: assetSearchResult.discovery_count,
          selected_count: assetSearchResult.selected?.length || 0,
          placement_rules: assetSearchResult.placement_rules,
        } : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("copilot-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
