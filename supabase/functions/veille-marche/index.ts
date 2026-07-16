import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Tu es l'analyste de veille marché d'Avranches Automatic.

Avranches Automatic est un distributeur français de flippers Stern Pinball (revendeur officiel), de jeux d'arcade, de grues et de jeux de tir. L'entreprise commercialise aussi la marque Hypernova Arcade.

Ta mission : rechercher sur le web les informations RÉCENTES (période précisée par l'utilisateur) sur :
(a) Les annonces et nouveautés produits de Stern Pinball et des fabricants arcade (UNIS, SEGA Amusement, Namco, Ace Amusement, Bandai Namco Amusement, Raw Thrills, Andamiro, Bay Tek, LAI Games, etc.).
(b) Ce que font les distributeurs de flippers et d'arcade en France et en Europe : promotions, événements, portes ouvertes, nouveaux showrooms, partenariats.
(c) Les salons et événements du secteur (IAAPA, EAG, salons français, tournois de flipper importants).
(d) Les tendances et signaux faibles du marché arcade / flipper, y compris ce qui se dit publiquement sur les réseaux sociaux (posts LinkedIn publics, pages Facebook publiques, presse spécialisée : Pinball News, Knapp Arcade, This Week in Pinball, Kaneda's Blog, Arcade Heroes, etc.).

Utilise l'outil web_search de façon intensive (jusqu'à 10 recherches) pour croiser plusieurs sources avant de conclure. Privilégie les sources primaires et récentes.

Format de réponse OBLIGATOIRE en Markdown structuré :

# Veille marché — {période}

## 🆕 Nouveautés produits
(annonces Stern, fabricants arcade, sorties, prototypes)

## 🏢 Concurrents et distributeurs
(actions des distributeurs FR/EU, promos, ouvertures)

## 📅 Événements à venir
(salons, tournois, portes ouvertes)

## 📈 Signaux et tendances
(analyse marché, signaux faibles, mouvements stratégiques)

## 🔗 Sources
Tableau markdown listant toutes les URLs consultées :

| Source | Sujet | URL |
|---|---|---|
| ... | ... | ... |

Reste factuel, cite tes sources dans le texte quand pertinent, et distingue clairement ce qui est confirmé de ce qui est rumeur. Si tu ne trouves rien de récent sur une section, indique-le honnêtement plutôt que d'inventer.`;

async function callAnthropic(messages: any[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 10 },
      ],
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }
  return await res.json();
}

function extractText(content: any[]): string {
  return (content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n\n");
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

Concentre-toi exclusivement sur les informations publiées ou survenues ${window}. Effectue plusieurs recherches web ciblées (Stern Pinball news, distributeurs flippers France, IAAPA, Pinball News, arcade industry, etc.) puis synthétise.`;

    let messages: any[] = [{ role: "user", content: userPrompt }];
    let finalContent: any[] = [];

    for (let i = 0; i < 6; i++) {
      const resp = await callAnthropic(messages);
      finalContent = resp.content;
      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason === "pause_turn") {
        // Continue: send the assistant turn back as-is by prompting continuation
        messages.push({ role: "user", content: "Continue." });
        continue;
      }
      break;
    }

    const contenu = extractText(finalContent) || "Aucun contenu généré.";
    const sources = extractSources(finalContent);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await sb
      .from("veille_rapports")
      .insert({ type, periode, contenu_markdown: contenu, sources })
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
