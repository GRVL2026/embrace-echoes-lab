import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── System prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un assistant IA V2 expert en aménagement de salles d'arcade, de loisirs et de divertissement.
Tu aides l'utilisateur à choisir l'ambiance, les matériaux, les textures, l'éclairage et les objets décoratifs de sa salle.

Tu es un assistant conversationnel intelligent. Tu comprends le langage naturel, les questions vagues, les reformulations et les demandes implicites. Tu peux :
- **Discuter librement** : répondre à des questions, expliquer tes choix, donner des conseils
- **Proposer des idées** : suggérer des ambiances, des combinaisons, des styles
- **Agir sur la scène** : quand l'utilisateur te demande explicitement de modifier quelque chose, utilise les outils appropriés

## QUAND UTILISER LES OUTILS vs RÉPONDRE EN TEXTE

- Si l'utilisateur pose une **question** ("c'est quoi un style industriel ?", "qu'est-ce que tu recommandes ?") → Réponds en texte, donne des conseils
- Si l'utilisateur exprime une **préférence vague** ("j'aime bien le côté rétro") → Réponds en texte avec des suggestions concrètes, propose d'appliquer
- Si l'utilisateur fait une **demande d'action** ("mets du béton au sol", "ajoute des plantes", "change l'ambiance en industriel") → Utilise les outils
- Si l'utilisateur dit **"oui"**, **"vas-y"**, **"ok fais-le"** après une suggestion → Utilise les outils pour appliquer ce que tu avais suggéré

## PLACEMENT SPATIAL INTELLIGENT (V2)

Tu reçois un contexte spatial de la salle (room_context) avec les murs, portes, poteaux, dimensions et équipements existants.
Tu DOIS utiliser ce contexte pour positionner les assets de manière logique et réaliste.

### RÈGLES DE PLACEMENT PAR TYPE D'ASSET

1. **OBJETS MURAUX** (placement_surface: "wall") — Tableaux, posters, néons, enseignes, horloges, étagères, appliques :
   - Doivent être placés CONTRE un mur
   - wall_height = hauteur depuis le sol (typiquement 150-220cm pour les décorations murales)
   - wall_index = index du mur dans le tableau walls[]
   - NE PAS placer devant une porte

2. **OBJETS AU SOL** (placement_surface: "floor") — Plantes, mobilier, bornes, comptoirs, statues :
   - Respecter un dégagement de circulation_width_cm (120cm)
   - Éviter les zones de porte (rayon = largeur_porte + 150cm)
   - Les plantes et éléments déco se placent idéalement dans les COINS ou le long des murs libres

3. **OBJETS DE PLAFOND** (placement_surface: "ceiling") — Lustres, projecteurs :
   - Centrer dans la pièce ou au-dessus des zones fonctionnelles

## ROUTAGE DES SOURCES

### TEXTURES & MATÉRIAUX → apply_scene_changes (source: Poly Haven)
Pour tout changement de matériau (sol, mur, plafond), utilise apply_scene_changes avec un **polyhaven_id** valide.

Exemples de polyhaven_id :
- SOL BÉTON : concrete_floor_02, concrete_floor_worn_001, polished_concrete
- SOL BOIS : wood_floor_deck, hardwood_brown_planks, oak_veneer_01
- SOL CARRELAGE : large_square_tiles, hexagonal_concrete, marble_01
- MUR BRIQUE : red_brick_04, brick_wall_003, medieval_blocks_02
- MUR BÉTON : concrete_wall_008, concrete_layers_02
- MUR BOIS : plywood, wood_cabinet_worn, oak_veneer_01
- MUR PEINTURE : utilise set_wall_color avec un code hex

### OBJETS 3D → find_3d_assets (source: Sketchfab + bibliothèque interne)
Pour tout objet physique (plantes, mobilier, néons, déco), utilise find_3d_assets.

### DEMANDES MIXTES → appelle LES DEUX outils
Si "ambiance industrielle avec des plantes", appelle apply_scene_changes ET find_3d_assets.

## Contraintes
- Réponds toujours en français
- Sois conversationnel, amical et professionnel
- Préfère quelques assets cohérents à beaucoup d'assets médiocres
- Explique brièvement tes choix
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

    // Inject room context for spatial placement intelligence
    if (room_context) {
      const wallsDesc = (room_context.walls || []).map((w: any, i: number) => {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const len = Math.round(Math.sqrt(dx * dx + dy * dy));
        return `Mur ${i}: (${Math.round(w.start.x)},${Math.round(w.start.y)}) -> (${Math.round(w.end.x)},${Math.round(w.end.y)}) ${len}cm`;
      }).join("\n");
      const doorsDesc = (room_context.doors || []).map((d: any, i: number) =>
        `Porte ${i}: pos(${Math.round(d.position.x)},${Math.round(d.position.y)}) larg ${d.width}cm${d.isMain ? " [PRINCIPALE]" : ""}`
      ).join("\n");
      const pillarsDesc = (room_context.pillars || []).map((p: any, i: number) =>
        `Poteau ${i}: (${Math.round(p.position.x)},${Math.round(p.position.y)}) ${p.width}x${p.depth}cm`
      ).join("\n");
      const equipDesc = (room_context.existing_equipment || []).map((e: any) =>
        `"${e.name}" a (${Math.round(e.position.x)},${Math.round(e.position.y)}) ${e.width}x${e.depth}cm rot${e.rotation}deg`
      ).join("\n");

      aiMessages.push({
        role: "system",
        content: `## CONTEXTE SPATIAL DE LA SALLE\n\nDimensions: ${room_context.room_width_cm}cm x ${room_context.room_depth_cm}cm, hauteur ${room_context.room_height_cm}cm.\nCorridor circulation: ${room_context.circulation_width_cm}cm.\n\n### Murs\n${wallsDesc}\n\n### Portes\n${doorsDesc}\n\n### Poteaux\n${pillarsDesc}\n\n### Equipements existants\n${equipDesc}\n\nIMPORTANT: Utilise ces donnees pour calculer les positions EXACTES. X=largeur, Z=profondeur (mappe au Y du plan 2D), Y=hauteur.`,
      });

      // Fetch past layout snapshots for similar room sizes to learn from
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const roomArea = (room_context.room_width_cm * room_context.room_depth_cm) / 10000;
        const { data: snapshots } = await sb
          .from("layout_snapshots")
          .select("project_name, equipment_placements, room_area_m2, equipment_count")
          .gte("room_area_m2", roomArea * 0.5)
          .lte("room_area_m2", roomArea * 2.0)
          .order("created_at", { ascending: false })
          .limit(3);

        if (snapshots && snapshots.length > 0) {
          const examples = snapshots.map((s: any) =>
            `Projet "${s.project_name}" (${s.room_area_m2}m², ${s.equipment_count} jeux): ${JSON.stringify(s.equipment_placements).slice(0, 500)}`
          ).join("\n\n");
          aiMessages.push({
            role: "system",
            content: `## EXEMPLES DE LAYOUTS VALIDÉS (apprentissage)\nVoici des agencements approuvés par l'utilisateur pour des salles similaires. Inspire-toi de ces patterns de placement :\n\n${examples}`,
          });
        }
      } catch (e) {
        console.warn("Could not fetch layout snapshots:", e);
      }
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
        tool_choice: "auto",
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

              // Convert selected assets to add_asset actions with V2 placement data
              if (assetSearchResult.selected) {
                // Build a map of category → placement info from the search plan
                const placementMap: Record<string, any> = {};
                for (const sp of (args.search_plan || [])) {
                  placementMap[sp.category] = {
                    surface: sp.placement_surface || "floor",
                    positions: sp.placement_positions || [],
                  };
                }

                let posIndex: Record<string, number> = {};
                for (const asset of assetSearchResult.selected) {
                  if (asset.glb_url) {
                    const cat = asset.category || "props";
                    const pm = placementMap[cat] || { surface: "floor", positions: [] };
                    const idx = posIndex[cat] || 0;
                    posIndex[cat] = idx + 1;
                    const pos = pm.positions[idx];

                    sceneActions.push({
                      type: "add_asset",
                      asset_id: asset.asset_db_id || asset.uid,
                      asset_name: asset.name,
                      glb_url: asset.glb_url,
                      category: cat,
                      thumbnail: asset.thumbnail,
                      placement_rule: args.placement_rules?.[cat] || "auto",
                      placement_surface: pm.surface,
                      ...(pos ? {
                        position: [pos.x || 0, pos.y || 0, pos.z || 0],
                        rotation: [0, pos.rotation_y || 0, 0],
                        wall_index: pos.wall_index,
                        wall_height: pos.wall_height,
                      } : {}),
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
