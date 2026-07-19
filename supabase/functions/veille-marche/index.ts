import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropicJson } from "../_shared/anthropic-fetch.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYNTH_MODEL = "claude-opus-4-8";
const COLLECT_MODEL = "claude-sonnet-5";

const WEB_SEARCH_TOOL = (maxUses: number) => ({
  type: "web_search_20260209", name: "web_search", max_uses: maxUses,
} as any);

const COLLECTOR_SYSTEM = `Tu es un collecteur de veille marché pour Avranches Automatic (distributeur français de flippers Stern, jeux d'arcade, grues, jeux de tir ; marque Hypernova Arcade).
Ta mission : effectuer plusieurs recherches web ciblées sur le périmètre qui t'est confié, puis rendre des NOTES BRUTES structurées (bullet points) : uniquement des faits datés, chiffrés si possible, avec les URLs sources entre parenthèses.
Ne rédige aucune synthèse, aucune conclusion : d'autres se chargeront de la synthèse. Sois exhaustif, factuel, distingue confirmé vs rumeur. Réponse finale en texte brut markdown (pas d'appel outil final).`;

const SYNTH_SYSTEM = `Tu es l'analyste de veille marché senior d'Avranches Automatic (distributeur français, revendeur officiel Stern Pinball, marque Hypernova Arcade).

Tu reçois 4 paquets de NOTES BRUTES rédigés par des collecteurs web spécialisés. Tu ne dois PAS refaire de recherches. Ta mission : synthétiser ces notes en un rapport structuré via l'outil build_veille.

Ta réponse finale DOIT être un unique appel à l'outil build_veille, sans texte libre. Sois factuel, distingue confirmé vs rumeur, si une section manque d'infos indique-le honnêtement plutôt que d'inventer.`;

const BUILD_VEILLE_TOOL = {
  name: "build_veille",
  description: "Produit la synthèse structurée finale du rapport de veille marché.",
  input_schema: {
    type: "object",
    properties: {
      titre: { type: "string" },
      periode: { type: "string" },
      resume_executif: { type: "string", description: "3 à 4 phrases max, ton direct." },
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
        description: "5 sections dans l'ordre : nouveautes, concurrents, evenements, tendances, barometre_stern.",
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
                  resume: { type: "string" },
                  points_cles: { type: "array", items: { type: "string" } },
                  importance: { type: "string", enum: ["haute", "moyenne", "info"] },
                  tonalite: { type: "string", enum: ["enthousiaste", "mitige", "negatif", "neutre"] },
                  statut_stern: { type: "string", enum: ["rumeur", "annonce", "sorti"] },
                  implication_aa: { type: "string" },
                  liens: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { label: { type: "string" }, url: { type: "string" } },
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

function findToolUse(content: any[], name: string) {
  return (content ?? []).find((b) => b?.type === "tool_use" && b?.name === name);
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

function extractText(content: any[]): string {
  return (content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

type CollectorResult = {
  notes: string;
  content: any[];
  quotaError: boolean;
  accountUnavailable: boolean;
  errorMessage: string | null;
  factualItems: number;
};

function inspectWebSearch(content: any[]) {
  const factualUrls = new Set<string>();
  const errorMessages: string[] = [];

  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== "object") return;

    if (node.type === "web_search_result" && typeof node.url === "string") {
      factualUrls.add(node.url);
    }
    if (node.type === "web_search_tool_result_error" || node.type === "error") {
      errorMessages.push(JSON.stringify(node));
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(content);

  // Certains modèles reformulent l'erreur outil dans leur texte final. On la
  // conserve pour le diagnostic, mais elle ne compte jamais comme un fait.
  const text = extractText(content);
  if (/server tool use limit exceeded|max_uses_exceeded|web search.{0,40}(?:limit|unavailable|disabled|not enabled)|(?:rate limit|429)/i.test(text)) {
    errorMessages.push(text);
  }

  const errorMessage = errorMessages.join(" | ").slice(0, 1200) || null;
  const quotaError = !!errorMessage && /server tool use limit exceeded|max_uses_exceeded|rate.?limit|\b429\b|quota/i.test(errorMessage);
  const accountUnavailable = !!errorMessage && /web.?search.{0,80}(?:unavailable|disabled|not enabled|not available|not permitted)|(?:account|organization|workspace).{0,80}(?:quota|limit|disabled)|billing|credit/i.test(errorMessage);

  return { factualItems: factualUrls.size, quotaError, accountUnavailable, errorMessage };
}

function failedCollector(message: string, quotaError: boolean, accountUnavailable = false): CollectorResult {
  return {
    notes: `(collecteur en échec : ${message})`,
    content: [],
    quotaError,
    accountUnavailable,
    errorMessage: message,
    factualItems: 0,
  };
}

async function runCollector(prompt: string, maxUses: number): Promise<CollectorResult> {
  const messages: any[] = [{ role: "user", content: prompt }];
  let allContent: any[] = [];
  let lastText = "";

  for (let i = 0; i < 6; i++) {
    const resp = await anthropicJson(ANTHROPIC_KEY, {
      model: COLLECT_MODEL,
      max_tokens: 6000,
      system: COLLECTOR_SYSTEM,
      tools: [WEB_SEARCH_TOOL(maxUses)],
      messages,
    });
    allContent.push(...(resp.content ?? []));
    messages.push({ role: "assistant", content: resp.content });
    lastText = extractText(resp.content);
    const inspection = inspectWebSearch(allContent);
    if (inspection.errorMessage) break;
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "user", content: "Continue." });
      continue;
    }
    break;
  }
  const inspection = inspectWebSearch(allContent);
  return { notes: lastText || "(aucune note produite)", content: allContent, ...inspection };
}

async function runCollectorWithRetry(label: string, prompt: string, maxUses: number): Promise<CollectorResult> {
  try {
    const first = await runCollector(prompt, maxUses);
    if (first.errorMessage) {
      console.error(`[veille] ${label} web_search error (HTTP 200 tool result): ${first.errorMessage}`);
    }
    if (first.accountUnavailable) return first;
    if (first.quotaError) {
      console.warn(`[veille] ${label} quota exceeded, retry in 60s`);
      await new Promise((r) => setTimeout(r, 60000));
      try {
        const retry = await runCollector(prompt, maxUses);
        if (retry.errorMessage) {
          console.error(`[veille] ${label} retry web_search error (HTTP 200 tool result): ${retry.errorMessage}`);
        }
        return retry;
      } catch (e: any) {
        return failedCollector(e?.message ?? String(e), true);
      }
    }
    return first;
  } catch (e: any) {
    const raw = `${e?.message ?? String(e)} ${e?.body ?? ""}`;
    const msg = raw.toLowerCase();
    const status = Number(e?.status ?? 0);
    const isQuota = status === 429 || /limit exceeded|max_uses|rate.?limit|quota/.test(msg);
    const isAccountUnavailable = /web.?search.{0,80}(?:unavailable|disabled|not enabled|not available|not permitted)|(?:account|organization|workspace).{0,80}(?:quota|limit|disabled)|billing|credit/.test(msg);
    console.error(`[veille] ${label} API error HTTP ${status || "inconnu"}: ${raw.slice(0, 1200)}`);
    if (isAccountUnavailable) return failedCollector(raw, isQuota, true);
    if (isQuota) {
      console.warn(`[veille] ${label} API quota error, retry in 60s`);
      await new Promise((r) => setTimeout(r, 60000));
      try { return await runCollector(prompt, maxUses); }
      catch (e2: any) { return failedCollector(e2?.message ?? String(e2), true); }
    }
    return failedCollector(raw, false);
  }
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
    const searchTurns = type === "quotidien" ? 2 : 3;

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Récupérer l'utilisateur qui lance la génération (pour le notifier à la fin)
    let ownerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const { data: userData } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
        ownerId = userData?.user?.id ?? null;
      } catch { /* ignore */ }
    }

    // Job de suivi (progression visible côté UI)
    const { data: job } = await sb
      .from("veille_jobs")
      .insert({ type, etape: "démarrage", owner_id: ownerId, progress: 5 })
      .select("id")
      .single();
    const jobId = job?.id as string | undefined;
    let lastProgress = 5;
    const setEtape = async (etape: string, progress?: number) => {
      if (!jobId) return;
      const patch: Record<string, unknown> = { etape, updated_at: new Date().toISOString() };
      if (typeof progress === "number") {
        const next = Math.max(lastProgress, Math.min(100, Math.round(progress)));
        lastProgress = next;
        patch.progress = next;
      }
      await sb.from("veille_jobs").update(patch).eq("id", jobId);
    };


    // Watchlist
    const { data: watchlist } = await sb
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
      return Object.entries(byCat).map(([c, n]) => `- ${c} : ${n.join(", ")}`).join("\n");
    };
    const wlP1 = groupByCat(1) || "(aucune)";
    const wlP2 = groupByCat(2) || "(aucune)";
    const wlP3 = groupByCat(3) || "(aucune)";

    // === COLLECTEURS STRICTEMENT SÉQUENTIELS ===
    const collectorA = `PÉRIMÈTRE : Baromètre Stern & flipper (${window}).
Cherche sur le web (Pinball News, This Week in Pinball, Kaneda's Blog, Pinside, Stern officiel, comptes réseaux sociaux Stern, presse spécialisée) :
(a) NOUVEAUX TITRES Stern : rumeurs, teasers, licences, annonces officielles.
(b) ACCUEIL DES SORTIES RÉCENTES : ressenti communautaire (qualité, prix, hype, critiques) sur Pinside en priorité + pages fans FR (Mordus de Flipper, Flippers Attitude, Flippers achat/vente).
(c) TENDANCES MARCHÉ FLIPPER : Jersey Jack, American Pinball, Chicago Gaming, Spooky, Multimorphic, prix occasion, nouveaux acteurs.
(d) POLITIQUE COMMERCIALE STERN : vente directe, marges revendeurs, exclusivités territoriales, prix publics imposés, conditions aux importateurs européens (Freddy's Pinball Paradise, Pinball Universe, RS Pinball, High Voltage Pinball).
Rends des notes brutes datées avec URLs. Distingue rumeur/annonce/sorti et enthousiaste/mitigé/négatif/neutre pour chaque titre.`;

    const collectorB = `PÉRIMÈTRE : Watchlist France (${window}).
Cherche des actualités RÉCENTES pour les comptes suivants (partenaires, concurrents, communauté, contentieux, exploitants). Utilise LinkedIn public, presse locale, sites, réseaux sociaux.

PRIORITÉ 1 (obligatoire, couvre chaque nom) :
${wlP1}

PRIORITÉ 2 (à couvrir si actualité récente) :
${wlP2}

LECTURE PARTICULIÈRE :
- reseau_revendeurs : partenaires distributeurs flippers d'AA AUJOURD'HUI, mais la nouvelle politique commerciale Stern les pousse vers la vente directe B2C → CONCURRENTS POTENTIELS. Surveille en priorité tout mouvement stratégique : offres B2C agressives, prix cassés, exclusivités revendiquées, communication qui contourne AA, rapprochements avec importateurs européens (Freddy's, Pinball Universe, RS Pinball, High Voltage).
- contentieux : ton STRICTEMENT FACTUEL, mouvements publics vérifiables uniquement, aucun jugement.
- MBA Entertainment : concurrent négoce + revendeur flipper AA + propriétaire La Tête dans les Nuages → double statut à monitorer.

Rends des notes brutes datées, chaque item préfixé de la catégorie entre crochets, avec URLs. Si aucun compte P1 n'a d'actu, dis-le honnêtement.`;

    const collectorC = `PÉRIMÈTRE : Marché arcade, FEC et distributeurs européens (${window}).
Cherche :
- Fabricants arcade : UNIS, SEGA Amusement, Namco, Bandai Namco Amusement, Raw Thrills, Andamiro, Bay Tek, LAI Games, Ace.
- Salons et événements : IAAPA, EAG, salons français, tournois flipper majeurs.
- FEC (Family Entertainment Centers) France et Europe : ouvertures, fermetures, tendances, cashless / systèmes de paiement, redemption.
- Distributeurs européens : Freddy's Pinball Paradise (DE), Pinball Universe (DE), RS Pinball (AT), High Voltage Pinball (BE) — mouvements, offres, événements.
- Tendances marché arcade en général.

Rends des notes brutes datées avec URLs, distingue confirmé vs rumeur.`;

    const collectorD = `PÉRIMÈTRE : TCG, blind box et e-commerce loisirs (${window}).
Cherche :
- Scène TCG : Pokemon, Yu-Gi-Oh, Magic — sorties, ruptures, spéculation, événements FR.
- Blind box / collectibles : Pop Mart, Labubu, Sonny Angel, tendances retail loisirs.
- E-commerce loisirs : mouvements Shopify, Amazon, marketplaces sur la niche jeu / collection.

Rends des notes brutes datées avec URLs.`;

    const runJob = async () => {
      try {
        const paquets: Array<CollectorResult & { label: string }> = [
          { label: "A · Baromètre Stern & flipper", ...failedCollector("non démarré", false) },
          { label: "B · Watchlist France", ...failedCollector("non démarré", false) },
          { label: "C · Marché arcade & FEC", ...failedCollector("non démarré", false) },
          { label: "D · TCG & e-commerce", ...failedCollector("non démarré", false) },
        ];
        const prompts = [collectorA, collectorB, collectorC, collectorD];
        // Jalons : 20 / 35 / 50 / 60 après chaque collecteur.
        const collectorProgress = [20, 35, 50, 60];
        for (let idx = 0; idx < prompts.length; idx++) {
          await setEtape(`collecte ${idx + 1}/4 (séquentielle · sonnet)`);
          const result = await runCollectorWithRetry(paquets[idx].label, prompts[idx], searchTurns);
          paquets[idx] = { label: paquets[idx].label, ...result };
          await setEtape(`collecte ${idx + 1}/4 terminée`, collectorProgress[idx]);
          if (idx < prompts.length - 1) {
            await setEtape(`collecte ${idx + 1}/4 (pause 20 s)`);
            await new Promise((r) => setTimeout(r, 20000));
          }
        }


        // === ANTI-RAPPORT-VIDE ===
        // On compte uniquement les vrais web_search_result, jamais les puces du
        // modèle (qui peuvent simplement décrire une erreur technique).
        const totalItems = paquets.reduce((sum, paquet) => sum + paquet.factualItems, 0);
        const emptyCount = paquets.filter((paquet) => paquet.factualItems === 0).length;
        if (totalItems === 0) {
          const accountUnavailable = paquets.some((paquet) => paquet.accountUnavailable);
          const allQuota = paquets.every((paquet) => paquet.quotaError);
          if (accountUnavailable) {
            throw new Error("La recherche web Anthropic est indisponible ou désactivée au niveau du compte. Vérifiez l'accès web_search de la clé API.");
          }
          if (allQuota) {
            throw new Error("Quota de recherches web saturé au niveau du serveur Anthropic, réessayez dans quelques minutes.");
          }
          throw new Error("Aucune donnée factuelle sourcée n'a été collectée : aucun rapport n'a été publié.");
        }

        await setEtape(`synthèse (opus · thinking${emptyCount ? ` · ${emptyCount} section(s) sans données` : ""})`, 70);

        const notesBlock = paquets.map((p) => `### PAQUET ${p.label}${p.items === 0 ? " (aucune donnée collectée)" : ""}\n\n${p.notes}`).join("\n\n---\n\n");

        const synthPrompt = `Période : ${periode}.

Voici les 4 paquets de notes brutes collectés en parallèle par des agents web spécialisés. Synthétise-les en un rapport complet via l'outil build_veille (5 sections dans l'ordre : nouveautes, concurrents, evenements, tendances, barometre_stern).

RÈGLES DE TAGGING WATCHLIST — pour chaque item qui mentionne une entité de la watchlist ci-dessous, préfixe le titre par la catégorie entre crochets (ex. « [reseau_revendeurs] Bananas Distribution ouvre… »). Catégories possibles : fabricants, concurrents, reseau_revendeurs, flipper, communaute_flipper, exploitants, tcg, presse, contentieux.

WATCHLIST P1 :
${wlP1}

WATCHLIST P2 :
${wlP2}

WATCHLIST P3 (mentions seulement si événement notable) :
${wlP3}

SECTION barometre_stern OBLIGATOIRE — pour chaque titre Stern renseigne statut_stern (rumeur/annonce/sorti), tonalite (enthousiaste/mitige/negatif/neutre + le pourquoi en 1 phrase dans le résumé), et implication_aa (lecture commerciale pour AA importateur Stern, 1 phrase). Traite tout signal de politique commerciale Stern ou de mouvement B2C d'un revendeur AA en importance "haute".

Si une section manque d'infos, mets un unique item d'importance "info" expliquant honnêtement l'absence d'actualité — n'invente rien.

=== NOTES BRUTES ===

${notesBlock}`;

        let synthContent: any[] = [];
        let toolCall: any = null;
        {
          const resp = await anthropicJson(ANTHROPIC_KEY, {
            model: SYNTH_MODEL,
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            system: SYNTH_SYSTEM,
            tools: [BUILD_VEILLE_TOOL],
            tool_choice: { type: "tool", name: "build_veille" },
            messages: [{ role: "user", content: synthPrompt }],
          });
          synthContent = resp.content ?? [];
          toolCall = findToolUse(synthContent, "build_veille");
        }
        if (!toolCall) throw new Error("Synthèse : build_veille non produit.");

        const structured = toolCall.input as any;
        const allContent = [...paquets.flatMap((p) => p.content), ...synthContent];
        const sources = extractSources(allContent);
        const realStructuredItems = (structured.sections ?? [])
          .flatMap((section: any) => section?.items ?? [])
          .filter((item: any) =>
            Array.isArray(item?.liens)
            && item.liens.some((link: any) => typeof link?.url === "string" && /^https?:\/\//.test(link.url))
            && !/aucune (?:donnée|actualité|information)|collecte non aboutie|échec technique/i.test(`${item?.titre ?? ""} ${item?.resume ?? ""}`)
          );
        // Second verrou immédiatement avant l'unique INSERT : même si la
        // synthèse réussit techniquement, un rapport sans item réel sourcé est refusé.
        if (sources.length === 0 || realStructuredItems.length === 0) {
          throw new Error("La synthèse ne contient aucun item factuel sourcé : aucun rapport n'a été publié.");
        }
        const md = [
          `# ${structured.titre ?? "Veille marché"}`,
          structured.periode ?? periode,
          "",
          structured.resume_executif ?? "",
        ].join("\n");

        const { data: inserted, error } = await sb.from("veille_rapports").insert({
          type,
          periode: structured.periode ?? periode,
          contenu_markdown: md,
          contenu_json: structured,
          sources,
          owner_id: ownerId,
        }).select("id").single();
        if (error) throw new Error(`Sauvegarde du rapport impossible : ${error.message}`);
        const rapportId = inserted?.id as string | undefined;

        if (jobId) await sb.from("veille_jobs").update({ etape: "terminé", done: true, updated_at: new Date().toISOString() }).eq("id", jobId);

        if (ownerId) {
          try {
            await sb.rpc("notify_user", {
              _user_id: ownerId,
              _type_cle: "veille_publiee",
              _titre: type === "quotidien" ? "Ton rapport de veille quotidien est prêt" : "Le rapport de veille hebdomadaire est disponible",
              _corps: structured.titre ?? periode,
              _lien: rapportId ? `/admin/veille?rapport=${rapportId}` : "/admin/veille",
              _gravite: "info",
            });
          } catch (nErr: any) {
            console.error("[veille-marche] notify_user veille_publiee failed", nErr?.message ?? nErr);
          }
        }
      } catch (e: any) {
        console.error("[veille-marche] background error", e?.message ?? e);
        const msg = (e?.message ?? String(e)).slice(0, 200);
        if (jobId) await sb.from("veille_jobs").update({ etape: `erreur : ${msg}`, done: true, updated_at: new Date().toISOString() }).eq("id", jobId);
        if (ownerId) {
          try {
            await sb.rpc("notify_user", {
              _user_id: ownerId,
              _type_cle: "veille_erreur",
              _titre: "La veille marché a échoué",
              _corps: msg,
              _lien: "/admin/veille",
              _gravite: "attention",
            });
          } catch (nErr: any) {
            console.error("[veille-marche] notify_user veille_erreur failed", nErr?.message ?? nErr);
          }
        }
      }
    };

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(runJob());

    return new Response(JSON.stringify({ status: "started", type, periode, job_id: jobId }), {
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
