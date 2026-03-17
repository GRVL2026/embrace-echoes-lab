import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── System prompt for the arcade copilot ───────────────────
const SYSTEM_PROMPT = `Tu es un assistant IA expert en aménagement de salles d'arcade, de loisirs et de divertissement.
Tu aides l'utilisateur à choisir l'ambiance, les matériaux, les textures et l'éclairage de sa salle.

Ton rôle est d'analyser les demandes (texte, images, liens web) et de proposer des modifications concrètes via des actions structurées.

## Actions disponibles (tool calling)

Tu peux appeler les fonctions suivantes pour modifier la scène :

- apply_material: Appliquer une texture Poly Haven sur sol/mur/plafond
- apply_lighting: Changer le preset d'éclairage (daylight, arcade, showroom)
- set_wall_color: Changer la couleur des murs (hex)
- set_ceiling: Changer le type de plafond (none, tiles, beams, black, technical)
- set_fog: Activer/désactiver le brouillard avec couleur et densité

## Contraintes

- Réponds toujours en français
- Sois concis et précis dans tes suggestions
- Propose des combinaisons cohérentes (matériaux + éclairage + couleurs)
- Si l'utilisateur envoie un lien web, analyse le branding pour s'en inspirer
- Si l'utilisateur envoie une image, décris ce que tu vois et propose des actions cohérentes
- Propose toujours des alternatives si possible

## Format de réponse

Réponds avec un texte explicatif de tes choix, puis utilise les tools pour appliquer les modifications.
`;

// ─── Tool definitions for structured output ─────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "apply_scene_changes",
      description:
        "Apply a batch of scene modifications: materials, lighting, colors, ceiling, fog. Call this with all the changes you want to make at once.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "List of actions to apply to the scene",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "apply_material",
                    "apply_lighting",
                    "set_wall_color",
                    "set_ceiling",
                    "set_fog",
                  ],
                },
                // apply_material
                target: {
                  type: "string",
                  enum: ["floor", "wall", "ceiling"],
                  description: "Surface target for material",
                },
                material_id: {
                  type: "string",
                  description: "Poly Haven asset ID (e.g. 'wood_floor_deck', 'brick_wall_002')",
                },
                material_name: {
                  type: "string",
                  description: "Human readable name",
                },
                resolution: {
                  type: "string",
                  enum: ["1k", "2k", "4k"],
                  description: "Texture resolution",
                },
                // apply_lighting
                preset: {
                  type: "string",
                  enum: ["daylight", "arcade", "showroom"],
                },
                // set_wall_color
                color: { type: "string", description: "Hex color like #1a1a2e" },
                // set_ceiling
                ceiling_type: {
                  type: "string",
                  enum: ["none", "tiles", "beams", "black", "technical"],
                },
                // set_fog
                enabled: { type: "boolean" },
                fog_color: { type: "string" },
                density: { type: "number", description: "0 to 1" },
              },
              required: ["type"],
            },
          },
          summary: {
            type: "string",
            description: "Brief summary of changes in French",
          },
          alternatives: {
            type: "array",
            items: { type: "string" },
            description: "Alternative suggestions the user could try",
          },
        },
        required: ["actions", "summary"],
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
      body: JSON.stringify({
        url: formattedUrl,
        formats: ["branding", "markdown"],
        onlyMainContent: true,
      }),
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
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build conversation messages
    const aiMessages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

    // If links provided, scrape them and add context
    if (links && links.length > 0) {
      const analyses = await Promise.all(links.map((url: string) => scrapeWebsite(url)));
      const webContext = analyses.join("\n\n---\n\n");
      aiMessages.push({
        role: "system",
        content: `L'utilisateur a partagé des liens web. Voici l'analyse:\n${webContext}\n\nUtilise ces informations pour inspirer tes suggestions d'ambiance.`,
      });
    }

    // Add conversation history
    for (const msg of messages) {
      if (msg.role === "user") {
        // Handle multimodal (text + images)
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

    // Call Lovable AI Gateway with tool calling
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
          JSON.stringify({ error: "Crédits IA épuisés. Ajoutez des crédits dans les paramètres." }),
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

    let textResponse = "";
    let actions: any[] = [];
    let summary = "";
    let alternatives: string[] = [];

    if (choice?.message?.content) {
      textResponse = choice.message.content;
    }

    // Parse tool calls
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.function?.name === "apply_scene_changes") {
          try {
            const args = JSON.parse(tc.function.arguments);
            actions = args.actions || [];
            summary = args.summary || "";
            alternatives = args.alternatives || [];
          } catch (e) {
            console.error("Failed to parse tool call args:", e);
          }
        }
      }
    }

    // Persist session if session_id provided
    if (session_id) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Get existing session
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
            copilot_response: { summary, actions, alternatives, warnings: [] },
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
        actions,
        summary,
        alternatives,
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
