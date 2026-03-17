import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── System prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un assistant IA expert en aménagement de salles d'arcade, de loisirs et de divertissement.
Tu aides l'utilisateur à choisir l'ambiance, les matériaux, les textures et l'éclairage de sa salle.

Ton rôle est d'analyser les demandes (texte, images, liens web) et de proposer des modifications concrètes via des actions structurées.

## Actions disponibles (tool calling)

Tu peux appeler les fonctions suivantes pour modifier la scène :

- apply_scene_changes: Modifier matériaux, éclairage, couleurs, plafond, fog
- find_3d_assets: Rechercher et importer des modèles 3D décoratifs depuis la bibliothèque

## Quand utiliser find_3d_assets

Utilise find_3d_assets quand l'utilisateur demande :
- de la décoration (murs, plafond, sols)
- du mobilier (chaises, tables, comptoirs)
- de l'éclairage décoratif
- de la signalétique
- des plantes ou végétation
- des props thématiques
- tout objet 3D pour enrichir la scène

Tu dois transformer la demande en un plan de recherche structuré avec :
- Un profil de style clair
- Des catégories fonctionnelles séparées
- Des requêtes spécialisées (pas de recherche brute)
- Des filtres négatifs pour exclure le hors-contexte

## Contraintes

- Réponds toujours en français
- Sois concis et précis dans tes suggestions
- Propose des combinaisons cohérentes (matériaux + éclairage + couleurs + objets)
- Préfère quelques assets cohérents à beaucoup d'assets médiocres
- Explique les substitutions et limites quand des éléments ne sont pas trouvés
- Si l'utilisateur envoie un lien web, analyse le branding pour s'en inspirer
- Si l'utilisateur envoie une image, décris ce que tu vois et propose des actions cohérentes
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
                material_id: { type: "string" },
                material_name: { type: "string" },
                resolution: { type: "string", enum: ["1k", "2k", "4k"] },
                preset: { type: "string", enum: ["daylight", "arcade", "showroom"] },
                color: { type: "string" },
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
      description: "Search and import 3D decorative assets for the scene. Generates a structured search plan with style profile, categories, and specialized queries.",
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
                queries: { type: "array", items: { type: "string" }, description: "3-8 specialized search queries. NOT brute search. Use intention + style + context." },
                max_candidates: { type: "number", description: "Max results per query, 8-12 recommended" },
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
          summary: { type: "string", description: "Summary of what assets are being searched for, in French" },
        },
        required: ["style_profile", "search_plan", "negative_filters", "placement_rules", "summary"],
      },
    },
  },
];

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
    const { messages, session_id, links } = await req.json();

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
        model: "google/gemini-2.5-flash",
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
            sceneActions = args.actions || [];
            summary = args.summary || "";
            alternatives = args.alternatives || [];
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
