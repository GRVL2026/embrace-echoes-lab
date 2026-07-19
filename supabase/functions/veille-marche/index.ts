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
        description: "Les 5 sections thématiques dans l'ordre : nouveautes, concurrents, evenements, tendances, barometre_stern.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ["nouveautes", "concurrents", "evenements", "tendances", "barometre_stern"] },
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
                  tonalite: {
                    type: "string",
                    enum: ["enthousiaste", "mitige", "negatif", "neutre"],
                    description: "Réservé à la section barometre_stern : ressenti communautaire dominant. Optionnel ailleurs.",
                  },
                  statut_stern: {
                    type: "string",
                    enum: ["rumeur", "annonce", "sorti"],
                    description: "Réservé à la section barometre_stern pour les titres Stern : stade du titre.",
                  },
                  implication_aa: {
                    type: "string",
                    description: "Réservé à la section barometre_stern : lecture commerciale pour Avranches Automatic (importateur Stern) en 1 phrase.",
                  },
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
  return await anthropicJson(ANTHROPIC_KEY, payload);
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

    // Charge la watchlist active pour orienter les recherches
    const sbEarly = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: watchlist } = await sbEarly
      .from("veille_watchlist")
      .select("nom, categorie, priorite, note")
      .eq("actif", true)
      .order("priorite", { ascending: true })
      .order("categorie", { ascending: true });

    const wl = (watchlist ?? []) as { nom: string; categorie: string; priorite: number; note: string | null }[];
    const groupByCat = (prio: number) => {
      const items = wl.filter((w) => w.priorite === prio);
      const byCat: Record<string, string[]> = {};
      for (const w of items) {
        const label = w.note ? `${w.nom} (${w.note})` : w.nom;
        (byCat[w.categorie] ||= []).push(label);
      }
      return Object.entries(byCat)
        .map(([cat, names]) => `- ${cat} : ${names.join(", ")}`)
        .join("\n");
    };

    const watchlistBlock = wl.length
      ? `\n\nWATCHLIST OFFICIELLE (à couvrir obligatoirement pour la priorité 1, opportunément pour la priorité 2) :\n\nPRIORITÉ 1 — obligatoire à chaque veille :\n${groupByCat(1) || "(aucune)"}\n\nPRIORITÉ 2 — à couvrir si actualité :\n${groupByCat(2) || "(aucune)"}\n\nPRIORITÉ 3 — signaux faibles, mentionner seulement si événement notable :\n${groupByCat(3) || "(aucune)"}\n\nRÈGLE DE TAGGING : pour chaque item de la veille qui mentionne une entité de cette watchlist, préfixe le titre par la catégorie correspondante entre crochets (ex. « [reseau_revendeurs] Bananas Distribution ouvre… »). Catégories possibles : fabricants, concurrents, reseau_revendeurs, flipper, communaute_flipper, exploitants, tcg, presse, contentieux.\n\nLECTURE PARTICULIÈRE PAR CATÉGORIE :\n- reseau_revendeurs : partenaires distributeurs flippers d'AA AUJOURD'HUI — mais la nouvelle politique commerciale de Stern pousse AA vers la vente directe B2C, ce qui en fait des CONCURRENTS POTENTIELS demain. Double lecture obligatoire : leurs succès restent des signaux réseau positifs à court terme, MAIS surveiller particulièrement leurs mouvements stratégiques — offres B2C agressives, prix cassés, exclusivités revendiquées, communication qui contourne AA, rapprochements avec d'autres importateurs européens (Freddy's Pinball Paradise, Pinball Universe, RS Pinball, High Voltage Pinball). Tout signal de ce type = ALERTE STRATÉGIQUE à faire remonter en tête de veille (importance "haute", tag [reseau_revendeurs]).\n- contentieux : entités en litige avec AA (ex. procès en cours). Ton STRICTEMENT FACTUEL, aucun jugement, aucune spéculation, uniquement mouvements publics vérifiables.\n- communaute_flipper : forums et groupes fans (source clé pour le baromètre Stern ci-dessous).\n\nSi tu ne trouves aucune actualité pour un compte prioritaire 1, ne rien inventer.\n\nVOLET OBLIGATOIRE — BAROMÈTRE STERN & FLIPPER (section id="barometre_stern") :\nÀ chaque veille, produis cette section dédiée. Elle DOIT couvrir :\n(a) NOUVEAUX TITRES Stern : rumeurs, teasers, licences évoquées, annonces officielles — sources Pinball News, This Week in Pinball, Kaneda's Blog, Pinside, comptes officiels Stern.\n(b) ACCUEIL DES SORTIES RÉCENTES : ressenti communautaire sur les derniers titres Stern (qualité, prix, hype, critiques) — sources Pinside en priorité, puis pages fans FR (Mordus de Flipper, Flippers Attitude, Flippers achat/vente).\n(c) TENDANCES MARCHÉ FLIPPER : mouvements globaux (prix occasion, concurrents Jersey Jack / American Pinball / Chicago Gaming / Spooky, nouveaux acteurs).\n(d) POLITIQUE COMMERCIALE STERN : surveiller toute évolution de la politique de distribution Stern (vente directe, marges revendeurs, exclusivités territoriales, prix publics imposés, conditions faites aux importateurs européens) — impact direct sur le modèle d'AA. Tout signal ici est à traiter en importance "haute".\nPour chaque item de titre Stern, renseigne "statut_stern" (rumeur/annonce/sorti), "tonalite" (enthousiaste/mitige/negatif/neutre + le "pourquoi" dans le résumé en 1 phrase), et "implication_aa" (lecture commerciale pour AA en tant qu'importateur Stern France : ex. « titre hype → pousser les précommandes », « accueil tiède → prudence sur les volumes »).`
      : "";

    const userPrompt = `Génère le rapport de veille marché pour la période : ${periode}.

Concentre-toi exclusivement sur les informations publiées ou survenues ${window}. Effectue plusieurs recherches web ciblées (Stern Pinball news, distributeurs flippers France, IAAPA, Pinball News, Pinside, arcade industry, etc.) puis synthétise. Ta réponse finale DOIT être un appel à l'outil build_veille avec les 5 sections remplies (nouveautes, concurrents, evenements, tendances, barometre_stern). Aucune section ne doit être vide : si tu n'as rien trouvé de récent, mets un unique item d'importance "info" expliquant honnêtement l'absence d'actualité.${watchlistBlock}`;

    // Tâche de fond : la génération peut prendre plusieurs minutes → dépasse la limite 150s du gateway.
    // On répond immédiatement 202 et on insère le rapport en base quand il est prêt (client poll).
    const runJob = async () => {
      try {
        let messages: any[] = [{ role: "user", content: userPrompt }];
        let finalContent: any[] = [];
        const allContent: any[] = [];

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
          if (findToolUse(resp.content, "build_veille")) break;
          if (resp.stop_reason === "pause_turn") {
            messages.push({ role: "user", content: "Continue." });
            continue;
          }
          break;
        }

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

        if (!toolCall) throw new Error("Le modèle n'a pas produit de sortie structurée build_veille.");

        const structured = toolCall.input as any;
        const sources = extractSources(allContent);
        const md = [
          `# ${structured.titre ?? "Veille marché"}`,
          structured.periode ?? periode,
          "",
          structured.resume_executif ?? "",
        ].join("\n");

        const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
        const { error } = await sb.from("veille_rapports").insert({
          type,
          periode: structured.periode ?? periode,
          contenu_markdown: md,
          contenu_json: structured,
          sources,
        });
        if (error) console.error("[veille-marche] insert error", error);
      } catch (e: any) {
        console.error("[veille-marche] background error", e?.message ?? e);
      }
    };

    // @ts-ignore EdgeRuntime is provided by Supabase edge runtime
    EdgeRuntime.waitUntil(runJob());

    return new Response(JSON.stringify({ status: "started", type, periode }), {
      status: 202,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error("[veille-marche]", e?.message ?? e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
