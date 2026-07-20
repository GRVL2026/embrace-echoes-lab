import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AnthropicApiError } from "../_shared/anthropic-fetch.ts";
import { scheduleSelfInvoke } from "../_shared/self-invoke.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYNTH_MODEL = "claude-opus-4-8";
const COLLECT_MODEL = "claude-sonnet-5";

// Étapes séquentielles auto-relancées
type Step = "collecte_a" | "collecte_b" | "collecte_c" | "collecte_d" | "synthese";
const STEP_ORDER: Step[] = ["collecte_a", "collecte_b", "collecte_c", "collecte_d", "synthese"];
const STEP_PROGRESS: Record<Step, number> = {
  collecte_a: 20, collecte_b: 35, collecte_c: 50, collecte_d: 60, synthese: 70,
};
const STEP_LABEL: Record<Step, string> = {
  collecte_a: "A · Baromètre Stern & flipper",
  collecte_b: "B · Watchlist France",
  collecte_c: "C · Marché arcade & FEC",
  collecte_d: "D · TCG & e-commerce",
  synthese: "Synthèse",
};

// Timeout dur par appel Anthropic (le runtime edge tue ~400s : aucun appel ne doit pendre).
const ANTHROPIC_TIMEOUT_MS = 150_000;
// Retry quota unique et rapide (30s max).
const QUOTA_RETRY_MS = 30_000;
// Un job non-done sans mise à jour depuis > 12 min est considéré zombie.
const ZOMBIE_MS = 12 * 60 * 1000;

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
    if (node.type === "web_search_result" && typeof node.url === "string") factualUrls.add(node.url);
    if (node.type === "web_search_tool_result_error" || node.type === "error") errorMessages.push(JSON.stringify(node));
    for (const value of Object.values(node)) walk(value);
  };
  walk(content);
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
  return { notes: `(collecteur en échec : ${message})`, content: [], quotaError, accountUnavailable, errorMessage: message, factualItems: 0 };
}

// Appel Anthropic direct avec AbortController pour garantir qu'aucun appel ne
// dépasse ANTHROPIC_TIMEOUT_MS. Ne pas passer par anthropicJson dont les
// retries transparents pourraient dépasser la limite globale de l'edge.
async function anthropicWithTimeout(payload: Record<string, unknown>): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new AnthropicApiError(res.status, text);
    try { return JSON.parse(text); } catch {
      throw new AnthropicApiError(res.status, `Invalid JSON. Body: ${text.slice(0, 800)}`);
    }
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Anthropic timeout (${Math.round(ANTHROPIC_TIMEOUT_MS / 1000)}s)`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function runCollector(prompt: string, maxUses: number): Promise<CollectorResult> {
  const messages: any[] = [{ role: "user", content: prompt }];
  let allContent: any[] = [];
  let lastText = "";
  for (let i = 0; i < 6; i++) {
    const resp = await anthropicWithTimeout({
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
    if (resp.stop_reason === "pause_turn") { messages.push({ role: "user", content: "Continue." }); continue; }
    break;
  }
  const inspection = inspectWebSearch(allContent);
  return { notes: lastText || "(aucune note produite)", content: allContent, ...inspection };
}

async function runCollectorWithRetry(label: string, prompt: string, maxUses: number): Promise<CollectorResult> {
  try {
    const first = await runCollector(prompt, maxUses);
    if (first.errorMessage) console.error(`[veille] ${label} web_search error: ${first.errorMessage}`);
    if (first.accountUnavailable) return first;
    if (first.quotaError) {
      console.warn(`[veille] ${label} quota, retry in ${QUOTA_RETRY_MS}ms (once)`);
      await new Promise((r) => setTimeout(r, QUOTA_RETRY_MS));
      try { return await runCollector(prompt, maxUses); }
      catch (e: any) { return failedCollector(e?.message ?? String(e), true); }
    }
    return first;
  } catch (e: any) {
    const raw = `${e?.message ?? String(e)} ${e?.body ?? ""}`;
    const msg = raw.toLowerCase();
    const status = Number(e?.status ?? 0);
    const isQuota = status === 429 || /limit exceeded|max_uses|rate.?limit|quota/.test(msg);
    const isAccountUnavailable = /web.?search.{0,80}(?:unavailable|disabled|not enabled|not available|not permitted)|(?:account|organization|workspace).{0,80}(?:quota|limit|disabled)|billing|credit/.test(msg);
    console.error(`[veille] ${label} API error HTTP ${status || "?"}: ${raw.slice(0, 1200)}`);
    if (isAccountUnavailable) return failedCollector(raw, isQuota, true);
    if (isQuota) {
      console.warn(`[veille] ${label} quota (API), retry in ${QUOTA_RETRY_MS}ms (once)`);
      await new Promise((r) => setTimeout(r, QUOTA_RETRY_MS));
      try { return await runCollector(prompt, maxUses); }
      catch (e2: any) { return failedCollector(e2?.message ?? String(e2), true); }
    }
    return failedCollector(raw, false);
  }
}

// --- helpers job/context ------------------------------------------------------

function buildContext(type: "quotidien" | "hebdomadaire", wl: any[]) {
  const now = new Date();
  const periode = type === "quotidien"
    ? `Journée du ${now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} (dernières 24h)`
    : `Semaine du ${new Date(now.getTime() - 7 * 86400000).toLocaleDateString("fr-FR")} au ${now.toLocaleDateString("fr-FR")} (7 derniers jours)`;
  const wnd = type === "quotidien" ? "dans les dernières 24 heures" : "au cours des 7 derniers jours";
  const searchTurns = type === "quotidien" ? 2 : 3;

  const groupByCat = (prio: number) => {
    const items = wl.filter((w: any) => w.priorite === prio);
    const byCat: Record<string, string[]> = {};
    for (const w of items) {
      const label = w.note ? `${w.nom} (${w.note})` : w.nom;
      (byCat[w.categorie] ||= []).push(label);
    }
    return Object.entries(byCat).map(([c, n]) => `- ${c} : ${n.join(", ")}`).join("\n");
  };

  return {
    type, periode, window: wnd, searchTurns,
    wlP1: groupByCat(1) || "(aucune)",
    wlP2: groupByCat(2) || "(aucune)",
    wlP3: groupByCat(3) || "(aucune)",
  };
}

function collectorPrompt(step: Step, ctx: any): string {
  const { window: wnd, wlP1, wlP2 } = ctx;
  switch (step) {
    case "collecte_a":
      return `PÉRIMÈTRE : Baromètre Stern & flipper (${wnd}).
Cherche sur le web (Pinball News, This Week in Pinball, Kaneda's Blog, Pinside, Stern officiel, réseaux sociaux Stern, presse spécialisée) :
(a) NOUVEAUX TITRES Stern : rumeurs, teasers, licences, annonces officielles.
(b) ACCUEIL DES SORTIES RÉCENTES : ressenti communautaire (qualité, prix, hype, critiques) sur Pinside + pages fans FR.
(c) TENDANCES MARCHÉ FLIPPER : Jersey Jack, American Pinball, Chicago Gaming, Spooky, Multimorphic, prix occasion, nouveaux acteurs.
(d) POLITIQUE COMMERCIALE STERN : vente directe, marges revendeurs, exclusivités, prix imposés, conditions aux importateurs européens.
Rends des notes brutes datées avec URLs. Distingue rumeur/annonce/sorti et enthousiaste/mitigé/négatif/neutre.`;
    case "collecte_b":
      return `PÉRIMÈTRE : Watchlist France (${wnd}).
Cherche des actualités RÉCENTES pour les comptes suivants.

PRIORITÉ 1 (obligatoire) :
${wlP1}

PRIORITÉ 2 (si actualité) :
${wlP2}

LECTURE PARTICULIÈRE :
- reseau_revendeurs : partenaires actuels d'AA, concurrents potentiels via vente directe B2C poussée par Stern.
- contentieux : STRICTEMENT FACTUEL.
- MBA Entertainment : double statut (négoce + revendeur AA + propriétaire La Tête dans les Nuages).

Notes brutes datées, chaque item préfixé de la catégorie entre crochets, avec URLs.`;
    case "collecte_c":
      return `PÉRIMÈTRE : Marché arcade, FEC et distributeurs européens (${wnd}).
Cherche : UNIS, SEGA Amusement, Namco, Bandai Namco, Raw Thrills, Andamiro, Bay Tek, LAI Games, Ace ; IAAPA, EAG ; FEC FR/EU (ouvertures, fermetures, cashless, redemption) ; Freddy's, Pinball Universe, RS Pinball, High Voltage.
Notes brutes datées avec URLs, distingue confirmé vs rumeur.`;
    case "collecte_d":
      return `PÉRIMÈTRE : TCG, blind box et e-commerce loisirs (${wnd}).
Cherche : Pokemon/Yu-Gi-Oh/Magic (sorties, ruptures, événements FR) ; Pop Mart, Labubu, Sonny Angel ; mouvements Shopify/Amazon/marketplaces sur loisirs/collection.
Notes brutes datées avec URLs.`;
    default:
      return "";
  }
}

function nextStep(current: Step): Step | null {
  const i = STEP_ORDER.indexOf(current);
  return i < 0 || i >= STEP_ORDER.length - 1 ? null : STEP_ORDER[i + 1];
}

// Auto-invocation garantie via le helper partagé (EdgeRuntime.waitUntil ⇒ la
// promesse ne peut pas être coupée quand la fonction courante retourne).
function selfInvoke(jobId: string) {
  scheduleSelfInvoke("veille-marche", { job_id: jobId }, {
    "x-internal-relay": SERVICE_ROLE,
    apikey: SERVICE_ROLE,
    authorization: `Bearer ${SERVICE_ROLE}`,
  });
}

// --- exécution d'une étape ----------------------------------------------------

async function runStep(sb: any, job: any): Promise<void> {
  const jobId = job.id as string;
  const step = job.step as Step;
  const ctx = job.context ?? {};
  const notesAcc: Record<string, any> = job.notes ?? {};

  const touch = async (patch: Record<string, unknown>) => {
    await sb.from("veille_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", jobId);
  };

  if (step !== "synthese") {
    const label = STEP_LABEL[step];
    await touch({ etape: `collecte ${STEP_ORDER.indexOf(step) + 1}/4 (${label})` });
    const result = await runCollectorWithRetry(label, collectorPrompt(step, ctx), ctx.searchTurns ?? 2);
    notesAcc[step] = {
      label,
      notes: result.notes,
      content: result.content,
      factualItems: result.factualItems,
      quotaError: result.quotaError,
      accountUnavailable: result.accountUnavailable,
      errorMessage: result.errorMessage,
    };
    const nxt = nextStep(step)!;
    await touch({
      notes: notesAcc,
      step: nxt,
      progress: STEP_PROGRESS[step],
      etape: `collecte ${STEP_ORDER.indexOf(step) + 1}/4 terminée`,
    });
    selfInvoke(jobId);
    return;
  }

  // === SYNTHÈSE ===
  await touch({ etape: "synthèse (opus)", progress: STEP_PROGRESS.synthese });
  const paquets = STEP_ORDER.slice(0, 4).map((s) => {
    const n = notesAcc[s] ?? {};
    return {
      label: n.label ?? STEP_LABEL[s],
      notes: n.notes ?? "(aucune note)",
      content: Array.isArray(n.content) ? n.content : [],
      factualItems: Number(n.factualItems ?? 0),
      quotaError: !!n.quotaError,
      accountUnavailable: !!n.accountUnavailable,
      errorMessage: n.errorMessage ?? null,
    };
  });

  // Anti-rapport-vide (verrou 1)
  const totalItems = paquets.reduce((s, p) => s + p.factualItems, 0);
  const emptyCount = paquets.filter((p) => p.factualItems === 0).length;
  if (totalItems === 0) {
    const accountUnavailable = paquets.some((p) => p.accountUnavailable);
    const allQuota = paquets.every((p) => p.quotaError);
    if (accountUnavailable) throw new Error("La recherche web Anthropic est indisponible au niveau du compte.");
    if (allQuota) throw new Error("Quota de recherches web saturé au niveau du serveur Anthropic.");
    throw new Error("Aucune donnée factuelle sourcée n'a été collectée : aucun rapport n'a été publié.");
  }

  const notesBlock = paquets.map((p) =>
    `### PAQUET ${p.label}${p.factualItems === 0 ? " (aucune donnée collectée)" : ""}\n\n${p.notes}`
  ).join("\n\n---\n\n");

  const synthPrompt = `Période : ${ctx.periode}.

Voici les 4 paquets de notes brutes. Synthétise via l'outil build_veille (5 sections : nouveautes, concurrents, evenements, tendances, barometre_stern).

RÈGLES TAGGING WATCHLIST — préfixe chaque titre concerné par la catégorie entre crochets. Catégories : fabricants, concurrents, reseau_revendeurs, flipper, communaute_flipper, exploitants, tcg, presse, contentieux.

WATCHLIST P1 :
${ctx.wlP1}

WATCHLIST P2 :
${ctx.wlP2}

WATCHLIST P3 :
${ctx.wlP3}

SECTION barometre_stern OBLIGATOIRE — pour chaque titre Stern : statut_stern, tonalite (+ pourquoi en 1 phrase), implication_aa (lecture commerciale pour AA). Tout signal politique commerciale Stern ou mouvement B2C d'un revendeur AA en importance "haute".

Si une section manque d'infos, mets un unique item "info" honnête — n'invente rien.

=== NOTES BRUTES ===

${notesBlock}`;

  const resp = await anthropicWithTimeout({
    model: SYNTH_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYNTH_SYSTEM,
    tools: [BUILD_VEILLE_TOOL],
    tool_choice: { type: "tool", name: "build_veille" },
    messages: [{ role: "user", content: synthPrompt }],
  });
  const synthContent = resp.content ?? [];
  const toolCall = findToolUse(synthContent, "build_veille");
  if (!toolCall) throw new Error("Synthèse : build_veille non produit.");

  const structured = toolCall.input as any;
  const allContent = [...paquets.flatMap((p) => p.content), ...synthContent];
  const sources = extractSources(allContent);
  const realStructuredItems = (structured.sections ?? [])
    .flatMap((s: any) => s?.items ?? [])
    .filter((it: any) =>
      Array.isArray(it?.liens)
      && it.liens.some((l: any) => typeof l?.url === "string" && /^https?:\/\//.test(l.url))
      && !/aucune (?:donnée|actualité|information)|collecte non aboutie|échec technique/i.test(`${it?.titre ?? ""} ${it?.resume ?? ""}`)
    );
  if (sources.length === 0 || realStructuredItems.length === 0) {
    throw new Error("La synthèse ne contient aucun item factuel sourcé : aucun rapport n'a été publié.");
  }

  await touch({ etape: "synthèse terminée", progress: 90 });

  const md = [
    `# ${structured.titre ?? "Veille marché"}`,
    structured.periode ?? ctx.periode,
    "",
    structured.resume_executif ?? "",
  ].join("\n");

  const { data: inserted, error } = await sb.from("veille_rapports").insert({
    type: ctx.type,
    periode: structured.periode ?? ctx.periode,
    contenu_markdown: md,
    contenu_json: structured,
    sources,
    owner_id: job.owner_id ?? null,
  }).select("id").single();
  if (error) throw new Error(`Sauvegarde du rapport impossible : ${error.message}`);

  await touch({ etape: "terminé", done: true, progress: 100 });

  if (job.owner_id) {
    try {
      await sb.rpc("notify_user", {
        _user_id: job.owner_id,
        _type_cle: "veille_publiee",
        _titre: ctx.type === "quotidien" ? "Ton rapport de veille quotidien est prêt" : "Le rapport de veille hebdomadaire est disponible",
        _corps: structured.titre ?? ctx.periode,
        _lien: inserted?.id ? `/admin/veille?rapport=${inserted.id}` : "/admin/veille",
        _gravite: "info",
      });
    } catch (nErr: any) { console.error("[veille] notify success failed", nErr?.message ?? nErr); }
  }
}

// --- HTTP entrypoint ----------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  // ============ MODE 2 : exécuter UNE étape d'un job existant ============
  if (body?.job_id) {
    const relay = req.headers.get("x-internal-relay");
    if (relay !== SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const jobId = body.job_id as string;

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil((async () => {
      const { data: job } = await sb.from("veille_jobs").select("*").eq("id", jobId).maybeSingle();
      if (!job || job.done) return;
      try {
        await runStep(sb, job);
      } catch (e: any) {
        const msg = (e?.message ?? String(e)).slice(0, 200);
        console.error(`[veille] step ${job.step} error`, msg);
        await sb.from("veille_jobs").update({
          etape: `erreur : ${msg}`, done: true, updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        if (job.owner_id) {
          try {
            await sb.rpc("notify_user", {
              _user_id: job.owner_id,
              _type_cle: "veille_erreur",
              _titre: "La veille marché a échoué",
              _corps: msg,
              _lien: "/admin/veille",
              _gravite: "attention",
            });
          } catch { /* ignore */ }
        }
      }
    })());

    return new Response(JSON.stringify({ status: "step_started", job_id: jobId }), {
      status: 202, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // ============ MODE 1 : créer un nouveau job ============
  try {
    const { type } = body as { type: "quotidien" | "hebdomadaire" };
    if (type !== "quotidien" && type !== "hebdomadaire") {
      return new Response(JSON.stringify({ error: "type invalide" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Marquer les jobs zombies AVANT tout nouveau lancement.
    const zombieCutoff = new Date(Date.now() - ZOMBIE_MS).toISOString();
    await sb.from("veille_jobs")
      .update({ done: true, etape: "erreur : interrompue", updated_at: new Date().toISOString() })
      .eq("done", false)
      .lt("updated_at", zombieCutoff);

    // Owner
    let ownerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const { data: userData } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
        ownerId = userData?.user?.id ?? null;
      } catch { /* ignore */ }
    }

    // Watchlist figée
    const { data: watchlist } = await sb.from("veille_watchlist")
      .select("nom, categorie, priorite, note")
      .eq("actif", true)
      .order("priorite", { ascending: true })
      .order("categorie", { ascending: true });
    const ctx = buildContext(type, watchlist ?? []);

    const { data: job, error: jobErr } = await sb.from("veille_jobs").insert({
      type,
      etape: "démarrage",
      owner_id: ownerId,
      progress: 5,
      step: "collecte_a",
      notes: {},
      context: ctx,
    }).select("id").single();
    if (jobErr || !job) throw new Error(`Création du job impossible : ${jobErr?.message ?? "?"}`);

    // Auto-invocation immédiate de la 1re étape.
    selfInvoke(job.id);

    return new Response(JSON.stringify({ status: "started", type, periode: ctx.periode, job_id: job.id }), {
      status: 202, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error("[veille-marche]", e?.message ?? e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
