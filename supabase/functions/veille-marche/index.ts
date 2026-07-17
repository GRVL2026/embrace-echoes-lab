import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropicJson, isAnthropicOverload } from "../_shared/anthropic-fetch.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `Tu es l'analyste de veille marché d'Avranches Automatic.

Avranches Automatic est un distributeur français de flippers Stern Pinball (revendeur officiel), de jeux d'arcade, de grues et de jeux de tir. L'entreprise commercialise aussi la marque Hypernova Arcade.

Ta mission : rechercher sur le web les informations RÉCENTES (période précisée par l'utilisateur) sur :
(a) Nouveautés produits Stern Pinball et fabricants arcade (UNIS, SEGA Amusement, Namco, Ace, Bandai Namco Amusement, Raw Thrills, Andamiro, Bay Tek, LAI Games, etc.).
(b) Actions des distributeurs de flippers / arcade France et Europe : promotions, événements, portes ouvertes, showrooms, partenariats.
(c) Salons et événements (IAAPA, EAG, salons français, tournois de flipper importants).
(d) Tendances et signaux faibles (LinkedIn public, presse spécialisée : Pinball News, Knapp Arcade, This Week in Pinball, Kaneda's Blog, Arcade Heroes, etc.).

Utilise l'outil web_search de façon intensive (jusqu'à 10 recherches) pour croiser plusieurs sources avant de conclure. Privilégie les sources primaires et récentes.

Ta réponse FINALE doit être un unique appel à l'outil build_veille avec des données structurées, sans texte libre. Aucun contenu ne doit être écrit en dehors de cet appel. Sois factuel, distingue clairement confirmé vs rumeur, et si une section manque d'infos récentes indique-le honnêtement plutôt que d'inventer.`;

const BUILD_VEILLE_TOOL = {
  name: "build_veille",
  description: "Produit la synthèse structurée finale du rapport de veille marché.",
  input_schema: {
    type: "object",
    properties: {
      titre: { type: "string", description: "Titre du rapport, court et parlant." },
      periode: { type: "string", description: "Période couverte, ex : « Semaine du 10 au 16 juillet 2026 »." },
      resume_executif: { type: "string", description: "Résumé exécutif en 3 à 4 phrases max, ton direct." },
      stats: {
        type: "object",
        properties: {
          nb_nouveautes: { type: "number" },
          nb_concurrents: { type: "number" },
          nb_evenements: { type: "number" },
          nb_sources: { type: "number" },
        },
        required: ["nb_nouveautes", "nb_concurrents", "nb_evenements", "nb_sources"],
      },
      sections: {
        type: "array",
        description: "Les 4 sections thématiques dans l'ordre : nouveautes, concurrents, evenements, tendances.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ["nouveautes", "concurrents", "evenements", "tendances"] },
            titre: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  titre: { type: "string" },
                  resume: { type: "string", description: "2-3 phrases max." },
                  points_cles: {
                    type: "array",
                    items: { type: "string", description: "Bullet courte." },
                  },
                  importance: { type: "string", enum: ["haute", "moyenne", "info"] },
                  liens: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        url: { type: "string" },
                      },
                      required: ["label", "url"],
                    },
                  },
                },
                required: ["titre", "resume", "points_cles", "importance", "liens"],
              },
            },
          },
          required: ["id", "titre", "items"],
        },
      },
    },
    required: ["titre", "periode", "resume_executif", "stats", "sections"],
  },
} as const;

const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 10 } as any;

async function callAnthropic(payload: any) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 800)}`);
  }
  return await res.json();
}

function extractSources(content: any[]): { title?: string; url: string }[] {
  const urls = new Map<string, { title?: string; url: string }>();
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "object") {
      if (typeof node.url === "string" && /^https?:\/\//.test(node.url)) {
        if (!urls.has(node.url)) urls.set(node.url, { url: node.url, title: node.title });
      }
      for (const k of Object.keys(node)) walk(node[k]);
    }
  };
  walk(content);
  return Array.from(urls.values());
}

function findToolUse(content: any[], name: string) {
  return (content ?? []).find((b) => b?.type === "tool_use" && b?.name === name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { type } = await req.json() as { type: "quotidien" | "hebdomadaire" };
    if (type !== "quotidien" && type !== "hebdomadaire") {
      return new Response(JSON.stringify({ error: "type invalide" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const now = new Date();
    const periode = type === "quotidien"
      ? `Journée du ${now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} (dernières 24h)`
      : `Semaine du ${new Date(now.getTime() - 7 * 86400000).toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")} (7 derniers jours)`;

    const window = type === "quotidien" ? "dans les dernières 24 heures" : "au cours des 7 derniers jours";

    const userPrompt = `Génère le rapport de veille marché pour la période : ${periode}.

Concentre-toi exclusivement sur les informations publiées ou survenues ${window}. Effectue plusieurs recherches web ciblées (Stern Pinball news, distributeurs flippers France, IAAPA, Pinball News, arcade industry, etc.) puis synthétise. Ta réponse finale DOIT être un appel à l'outil build_veille avec toutes les sections remplies. Aucune section ne doit être vide : si tu n'as rien trouvé de récent, mets un unique item d'importance "info" expliquant honnêtement l'absence d'actualité.`;

    let messages: any[] = [{ role: "user", content: userPrompt }];
    let finalContent: any[] = [];
    const allContent: any[] = [];

    // Boucle exploration web (jusqu'à 8 tours), tools = web_search + build_veille dispo
    for (let i = 0; i < 8; i++) {
      const resp = await callAnthropic({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: SYSTEM_PROMPT,
        tools: [WEB_SEARCH_TOOL, BUILD_VEILLE_TOOL],
        messages,
      });
      finalContent = resp.content;
      allContent.push(...(resp.content ?? []));
      messages.push({ role: "assistant", content: resp.content });

      // Si build_veille a été appelé, on stoppe
      if (findToolUse(resp.content, "build_veille")) break;

      if (resp.stop_reason === "pause_turn") {
        messages.push({ role: "user", content: "Continue." });
        continue;
      }
      // stop_reason = end_turn ou tool_use non résolu autre : on relance en forçant build_veille
      break;
    }

    // Si pas encore d'appel build_veille, force-le
    let toolCall = findToolUse(finalContent, "build_veille");
    if (!toolCall) {
      messages.push({
        role: "user",
        content: "Appelle maintenant l'outil build_veille avec toutes les sections structurées, sans texte libre.",
      });
      const forced = await callAnthropic({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: SYSTEM_PROMPT,
        tools: [WEB_SEARCH_TOOL, BUILD_VEILLE_TOOL],
        tool_choice: { type: "tool", name: "build_veille" },
        messages,
      });
      finalContent = forced.content;
      allContent.push(...(forced.content ?? []));
      toolCall = findToolUse(forced.content, "build_veille");
    }

    if (!toolCall) {
      throw new Error("Le modèle n'a pas produit de sortie structurée build_veille.");
    }

    const structured = toolCall.input as any;
    const sources = extractSources(allContent);

    // Markdown fallback minimal pour compatibilité colonne NOT NULL
    const md = [
      `# ${structured.titre ?? "Veille marché"}`,
      structured.periode ?? periode,
      "",
      structured.resume_executif ?? "",
    ].join("\n");

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await sb
      .from("veille_rapports")
      .insert({
        type,
        periode: structured.periode ?? periode,
        contenu_markdown: md,
        contenu_json: structured,
        sources,
      })
      .select()
      .single();
    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error("[veille-marche]", e?.message ?? e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
