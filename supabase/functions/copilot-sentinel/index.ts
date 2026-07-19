// Sentinelle Copilote Jarvis — Phase 2.
//
// Objectif : exécuter chaque matin (via pg_cron) et à la demande (admins)
// une batterie de DETECTEURS SQL sur les données existantes, puis demander
// à Anthropic (claude-sonnet-5) de rédiger les alertes retenues + un
// briefing du matin structuré.
//
// - Upsert idempotent sur `dedupe_key` : une alerte identique non traitée
//   n'est pas recréée ; les statuts 'traite' / 'ignore' sont respectés.
// - Briefing du jour = ligne unique dans `copilot_briefings` (PK = date).
// - Fraîcheur des données : dernière ligne `gaia_sync_log` transmise à l'IA
//   et rappelée dans le briefing.
// - Détecteurs enveloppés dans try/catch : la sentinelle continue même si
//   une vue est momentanément indisponible.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropicJson, isAnthropicOverload } from "../_shared/anthropic-fetch.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const MODEL = "claude-sonnet-5";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Signal = {
  id: string;              // identifiant du détecteur
  titre: string;           // libellé humain
  visibilite: "copilot" | "direction";
  rows: any[];             // données brutes
  note?: string;           // consigne d'interprétation pour l'IA
};

// ─────────────────────────────────────────────────────────────────────────────
// DETECTEURS SQL
// ─────────────────────────────────────────────────────────────────────────────

async function safeRpc<T = any>(sql: string): Promise<T[]> {
  const { data, error } = await admin.rpc("gaia_query", { sql_query: sql });
  if (error) {
    console.warn("gaia_query error", error.message);
    return [];
  }
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && "error" in (data as any)) {
    console.warn("gaia_query returned error", (data as any).error);
    return [];
  }
  return [];
}

async function safeTable(fn: () => Promise<{ data: any; error: any }>) {
  try {
    const { data, error } = await fn();
    if (error) { console.warn("table query error", error.message); return []; }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("table query exception", (e as Error).message);
    return [];
  }
}

async function collectSignals(): Promise<Signal[]> {
  const signals: Signal[] = [];

  // 1. Clients majeurs en fort déclin vs N-1
  signals.push({
    id: "clients_declin",
    titre: "Clients majeurs en déclin (YTD vs N-1)",
    visibilite: "copilot",
    note: "Cible : clients dont le CA HT hors SFA a chuté de plus de 30% vs même période N-1 avec un CA N-1 > 20k€.",
    rows: await safeRpc(`
      select client, ca_n, ca_n1, (ca_n - ca_n1) as delta,
             round(((ca_n - ca_n1) / nullif(ca_n1,0) * 100)::numeric, 1) as pct
      from v_gaia_clients_evolution
      where ca_n1 > 20000
        and ca_n < ca_n1 * 0.7
      order by (ca_n1 - ca_n) desc
      limit 15
    `),
  });

  // 2. Devis importants sans mouvement
  signals.push({
    id: "devis_dormants",
    titre: "Devis importants sans mouvement 30-90j",
    visibilite: "copilot",
    note: "Devis (statut ouvert) montant > 10 000€ HT, dernière modif entre 30 et 90 jours.",
    rows: await safeRpc(`
      select numero, client, montant_ht, date_document,
             extract(day from now() - date_document)::int as anciennete_j
      from v_gaia_carn_documents
      where type = 'devis'
        and coalesce(sfa,false) = false
        and montant_ht > 10000
        and coalesce(statut,'ouvert') not in ('perdu','gagne','ferme','annule')
        and date_document between now() - interval '90 days' and now() - interval '30 days'
      order by montant_ht desc
      limit 20
    `),
  });

  // 3. Ruptures magasin qui se vendent
  signals.push({
    id: "ruptures_magasin",
    titre: "Ruptures pièces magasin à forte rotation",
    visibilite: "copilot",
    note: "Articles MAGASIN en rupture (stock<=0) qui ont généré du CA sur 6 mois.",
    rows: await safeRpc(`
      select code, description, ca_6m, ventes_6m, stock
      from v_gaia_magasin_ruptures
      order by ca_6m desc nulls last
      limit 15
    `),
  });

  // 4. Clients avec réparations mais 0 achat 6 mois
  signals.push({
    id: "sav_sans_relance",
    titre: "Clients en SAV/réparation sans achat récent",
    visibilite: "copilot",
    note: "Clients avec au moins une intervention SAV en cours mais aucun achat > 0 depuis 6 mois : cible de relance commerciale.",
    rows: await safeRpc(`
      select distinct c.client, coalesce(s.dernier_ticket, null) as dernier_ticket
      from v_gaia_clients_sav_actifs c
      left join v_gaia_clients_dernier_achat s on s.client = c.client
      where s.dernier_achat is null or s.dernier_achat < now() - interval '6 months'
      limit 20
    `),
  });

  // 5. Tickets SAV urgents / longs
  signals.push({
    id: "sav_urgents",
    titre: "Tickets SAV urgents ou ouverts >7 jours",
    visibilite: "copilot",
    note: "D'après zendesk_stats_cache et zendesk_ticket_summaries.",
    rows: await safeTable(() =>
      admin.from("zendesk_ticket_summaries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30) as any
    ),
  });

  // 6. Dérive de marge par famille — DIRECTION UNIQUEMENT
  signals.push({
    id: "marge_derive",
    titre: "Dérive de marge par famille vs N-1",
    visibilite: "direction",
    note: "Familles dont le taux de marque brute a baissé de plus de 3 points vs N-1.",
    rows: await safeRpc(`
      select famille, tx_marque_n, tx_marque_n1, (tx_marque_n - tx_marque_n1) as delta_pts
      from v_gaia_marge_famille_evolution
      where tx_marque_n1 - tx_marque_n > 3
      order by (tx_marque_n1 - tx_marque_n) desc
      limit 10
    `),
  });

  // 7. Items importance haute du dernier rapport de veille
  const veille = await safeTable(() =>
    admin.from("veille_rapports")
      .select("id, created_at, contenu_json")
      .order("created_at", { ascending: false })
      .limit(1) as any
  );
  const lastVeille = veille[0];
  const veilleItemsHauts: any[] = [];
  try {
    const sections = lastVeille?.contenu_json?.sections ?? [];
    for (const sec of sections) {
      for (const it of sec.items ?? []) {
        if (it.importance === "haute") {
          veilleItemsHauts.push({
            section: sec.id,
            titre: it.titre,
            resume: it.resume,
            implication_aa: it.implication_aa,
          });
        }
      }
    }
  } catch { /* ignore */ }
  signals.push({
    id: "veille_haute",
    titre: "Signaux veille marché — importance haute",
    visibilite: "copilot",
    note: "Extraits du dernier rapport de veille : signaux à surveiller (revendeurs B2C, politique Stern, tendances).",
    rows: veilleItemsHauts.slice(0, 12),
  });

  // 8. Gonflement du carnet de reliquats
  signals.push({
    id: "reliquats_gonflement",
    titre: "Gonflement anormal du carnet de reliquats",
    visibilite: "copilot",
    note: "Total reliquats vs il y a 1 mois : signaler si progression > 20%.",
    rows: await safeRpc(`
      with cur as (
        select coalesce(sum(montant_ht),0) as total_now
        from v_gaia_carn_documents
        where type = 'reliquat' and coalesce(sfa,false) = false
      )
      select total_now from cur
    `),
  });

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA anthropic tool
// ─────────────────────────────────────────────────────────────────────────────

const BUILD_TOOL = {
  name: "build_sentinelle",
  description: "Produit la liste des alertes à créer/actualiser + le briefing du matin.",
  input_schema: {
    type: "object",
    properties: {
      alertes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Identifiant machine (ex clients_declin, devis_dormants...)" },
            gravite: { type: "string", enum: ["info", "attention", "urgent"] },
            titre: { type: "string" },
            constat: { type: "string", description: "Constat CHIFFRE en une à deux phrases." },
            action_suggeree: { type: "string", description: "Action CONCRETE recommandée." },
            lien: { type: "string", description: "Route interne (ex /admin/gaia#magasin, /admin/gaia/client/<id>)." },
            visibilite: { type: "string", enum: ["copilot", "direction"] },
            dedupe_key: { type: "string", description: "Clé stable type+entite (ex 'devis_dormants:D12345')." },
          },
          required: ["type", "gravite", "titre", "constat", "action_suggeree", "lien", "visibilite", "dedupe_key"],
        },
      },
      briefing: {
        type: "object",
        properties: {
          resume: { type: "string", description: "2-3 phrases d'ouverture, ton direct." },
          fraicheur: { type: "string", description: "Ex 'Données à jour de la dernière synchro Cegid : 18/07/2026 06h32.'" },
          changements: {
            type: "array",
            description: "Ce qui a changé depuis la veille (facturations, devis signés/perdus, nouveaux tickets).",
            items: {
              type: "object",
              properties: {
                titre: { type: "string" },
                detail: { type: "string" },
              },
              required: ["titre", "detail"],
            },
          },
          alertes_nouvelles: {
            type: "array",
            description: "Rappel synthétique des alertes du jour (2-5 items).",
            items: { type: "string" },
          },
          opportunites: {
            type: "array",
            description: "1 à 2 opportunités actionnables aujourd'hui.",
            items: {
              type: "object",
              properties: {
                titre: { type: "string" },
                detail: { type: "string" },
                lien: { type: "string" },
              },
              required: ["titre", "detail"],
            },
          },
        },
        required: ["resume", "fraicheur", "changements", "alertes_nouvelles", "opportunites"],
      },
    },
    required: ["alertes", "briefing"],
  },
} as const;

const SYSTEM = `Tu es la sentinelle du Copilote d'Avranches Automatic (distributeur français Stern Pinball, arcade, grues ; marque Hypernova Arcade).

Tu reçois des "signaux" bruts issus de détecteurs SQL. Ta mission : sélectionner les plus importants, formuler des alertes FACTUELLES avec constat CHIFFRÉ et action CONCRÈTE, puis composer le briefing du matin.

Règles strictes :
- N'invente aucun chiffre : n'utilise que ce qui figure dans les signaux.
- Si un signal est vide ou anecdotique, ignore-le (n'invente pas d'alerte pour combler).
- La marge (signal marge_derive) est CONFIDENTIELLE : visibilite='direction'.
- dedupe_key = "<type>:<identifiant_stable>" (ex "devis_dormants:D12345", "clients_declin:CLIENT_XYZ", "sav_urgents:12345"). Si pas d'identifiant, utilise un slug reproductible.
- Gravité : 'urgent' pour perte imminente / rupture bloquante ; 'attention' pour signaux nets ; 'info' pour observation utile.
- Liens : routes internes uniquement (ex /admin/gaia#magasin, /admin/gaia/carnet/devis, /admin/gaia/client/<slug>, /admin/veille).
- Briefing : mentionne toujours la fraîcheur des données (dernière synchro Cegid).
- Réponse : UN SEUL appel à build_sentinelle, sans texte libre.`;

async function callAnthropic(signals: Signal[], fraicheur: string) {
  const userPayload = {
    fraicheur_donnees: fraicheur,
    signaux: signals.map((s) => ({
      id: s.id, titre: s.titre, visibilite: s.visibilite,
      note: s.note, nb: s.rows.length, echantillon: s.rows.slice(0, 15),
    })),
  };

  const res = await anthropicJson(ANTHROPIC_KEY, {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [BUILD_TOOL as any],
    tool_choice: { type: "tool", name: "build_sentinelle" },
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Signaux du jour :\n\n" + JSON.stringify(userPayload) }],
    }],
  });

  const block = (res?.content ?? []).find((b: any) => b?.type === "tool_use" && b?.name === "build_sentinelle");
  if (!block) throw new Error("Aucun tool_use retourné par le modèle");
  return block.input as { alertes: any[]; briefing: any };
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

async function runSentinel() {
  // Fraîcheur des données
  const sync = await safeTable(() =>
    admin.from("gaia_sync_log")
      .select("created_at, status, source")
      .order("created_at", { ascending: false })
      .limit(1) as any
  );
  const last = sync[0]?.created_at ? new Date(sync[0].created_at) : null;
  const fraicheur = last
    ? `Dernière synchro Cegid : ${last.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`
    : "Fraîcheur des données inconnue (aucun log de synchro trouvé).";

  const signals = await collectSignals();

  let ai: { alertes: any[]; briefing: any };
  try {
    ai = await callAnthropic(signals, fraicheur);
  } catch (e) {
    if (isAnthropicOverload(e)) throw e;
    // Fallback : briefing minimal, aucune alerte inventée.
    ai = {
      alertes: [],
      briefing: {
        resume: "La sentinelle n'a pas pu joindre l'IA pour composer le briefing.",
        fraicheur,
        changements: [],
        alertes_nouvelles: [],
        opportunites: [],
      },
    };
    console.error("sentinelle IA fallback:", (e as Error).message);
  }

  // Upsert alertes (préserve statut existant)
  let created = 0;
  for (const a of ai.alertes ?? []) {
    try {
      const { data: existing } = await admin
        .from("copilot_alertes")
        .select("id, statut")
        .eq("dedupe_key", a.dedupe_key)
        .maybeSingle();

      if (existing) {
        // On rafraîchit constat/action, mais on NE réouvre PAS une alerte traitée/ignorée.
        await admin.from("copilot_alertes").update({
          titre: a.titre, constat: a.constat, action_suggeree: a.action_suggeree,
          lien: a.lien, gravite: a.gravite, updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await admin.from("copilot_alertes").insert({
          type: a.type, gravite: a.gravite, titre: a.titre, constat: a.constat,
          action_suggeree: a.action_suggeree, lien: a.lien,
          visibilite: a.visibilite, dedupe_key: a.dedupe_key, statut: "nouveau",
        });
        created += 1;
      }
    } catch (e) {
      console.warn("upsert alerte failed", a.dedupe_key, (e as Error).message);
    }
  }

  // Upsert briefing du jour
  const today = new Date().toISOString().slice(0, 10);
  await admin.from("copilot_briefings").upsert({
    date: today,
    contenu: ai.briefing,
    updated_at: new Date().toISOString(),
  });

  return { ok: true, signals_count: signals.length, alertes_generees: (ai.alertes ?? []).length, alertes_nouvelles: created, date: today };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP entry
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth : soit CRON_SECRET (env ou gaia_config.cron_secret pour pg_cron), soit user admin/direction.
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const cronHeader = req.headers.get("x-cron-secret") ?? url.searchParams.get("secret") ?? "";
    let isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
    if (!isCron && cronHeader) {
      const { data: cfg } = await admin.from("gaia_config").select("value").eq("key", "cron_secret").maybeSingle();
      if (cfg?.value && cronHeader === cfg.value) isCron = true;
    }

    if (!isCron) {
      // Vérifie l'utilisateur (doit être admin ou direction)
      const { data: userData } = await admin.auth.getUser(bearer);
      const uid = userData?.user?.id;
      if (!uid) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
      const isAllowed = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "direction");
      if (!isAllowed) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await runSentinel();
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sentinelle error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
