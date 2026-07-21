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
// MOUVEMENTS COMMERCE — snapshot & diff quotidien
// ─────────────────────────────────────────────────────────────────────────────

type CarnetRow = {
  n_cde: string;
  order_type: string | null;
  categorie: string | null;
  statut: string | null;
  code_client: string | null;
  client: string | null;
  total_ht: number | null;
  sfa: boolean | null;
};

type MouvementsCommerce = {
  first_run: boolean;
  nouveaux_devis: any[];
  nouvelles_commandes: any[];
  changements_statut: any[];
  totaux: {
    nb_nouveaux_devis: number; montant_nouveaux_devis: number;
    nb_nouvelles_commandes: number; montant_nouvelles_commandes: number;
    nb_changements: number;
  };
};

async function computeMouvementsCommerce(today: string): Promise<MouvementsCommerce> {
  const empty: MouvementsCommerce = {
    first_run: false,
    nouveaux_devis: [], nouvelles_commandes: [], changements_statut: [],
    totaux: { nb_nouveaux_devis: 0, montant_nouveaux_devis: 0, nb_nouvelles_commandes: 0, montant_nouvelles_commandes: 0, nb_changements: 0 },
  };

  // 1. Photo du jour depuis v_gaia_carnet_documents (devis et commandes ouverts/récents)
  const { data: currentData, error: curErr } = await admin
    .from("v_gaia_carnet_documents")
    .select("n_cde, order_type, categorie, statut, code_client, client, total_ht, sfa, date_document")
    .in("categorie", ["devis", "commande"]);
  if (curErr) { console.warn("carnet snapshot fetch error", curErr.message); return empty; }
  const current: CarnetRow[] = (currentData ?? []).map((r: any) => ({
    n_cde: String(r.n_cde ?? "").trim(),
    order_type: r.order_type, categorie: r.categorie, statut: r.statut,
    code_client: r.code_client, client: r.client,
    total_ht: r.total_ht == null ? null : Number(r.total_ht),
    sfa: !!r.sfa,
  })).filter((r) => r.n_cde);

  // 2. Insérer la photo du jour (upsert au cas où on relance dans la même journée)
  if (current.length > 0) {
    const rows = current.map((r) => ({ snapshot_date: today, ...r }));
    // Insert par lots de 1000
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await admin.from("gaia_carnet_snapshot").upsert(chunk, { onConflict: "snapshot_date,n_cde" });
      if (error) console.warn("snapshot upsert error", error.message);
    }
  }

  // 3. Purge > 35 jours
  try {
    const cutoff = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
    await admin.from("gaia_carnet_snapshot").delete().lt("snapshot_date", cutoff);
  } catch (e) { console.warn("snapshot purge failed", (e as Error).message); }

  // 4. Charger la photo précédente la plus récente (< today)
  const { data: prevDateData } = await admin
    .from("gaia_carnet_snapshot")
    .select("snapshot_date")
    .lt("snapshot_date", today)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const prevDate = (prevDateData ?? [])[0]?.snapshot_date;
  if (!prevDate) return { ...empty, first_run: true };

  const { data: prevData } = await admin
    .from("gaia_carnet_snapshot")
    .select("n_cde, order_type, categorie, statut, code_client, client, total_ht, sfa")
    .eq("snapshot_date", prevDate);
  const prevMap = new Map<string, CarnetRow>();
  for (const r of (prevData ?? []) as any[]) prevMap.set(String(r.n_cde).trim(), r);

  const nouveaux_devis: any[] = [];
  const nouvelles_commandes: any[] = [];
  const changements_statut: any[] = [];

  for (const r of current) {
    const prev = prevMap.get(r.n_cde);
    if (!prev) {
      // Nouveau document
      const base = {
        n_cde: r.n_cde, client: r.client, code_client: r.code_client,
        total_ht: r.total_ht ?? 0, statut: r.statut, sfa: r.sfa,
      };
      if (r.categorie === "devis") nouveaux_devis.push(base);
      else if (r.categorie === "commande") {
        // Détection conversion devis→commande : ancien devis (autre n_cde) même client + même montant approx ?
        // Trop fragile — on se contente d'un flag "peut-être conversion" si un devis prev même client & montant existe.
        let converti: string | null = null;
        for (const [pn, p] of prevMap) {
          if (p.categorie === "devis" && p.code_client === r.code_client &&
              Math.abs(Number(p.total_ht ?? 0) - Number(r.total_ht ?? 0)) < 1 &&
              !current.find((c) => c.n_cde === pn)) {
            converti = pn; break;
          }
        }
        nouvelles_commandes.push({ ...base, converti_depuis: converti });
      }
    } else if ((prev.statut ?? "") !== (r.statut ?? "")) {
      changements_statut.push({
        n_cde: r.n_cde, client: r.client, categorie: r.categorie,
        total_ht: r.total_ht ?? 0, statut_avant: prev.statut, statut_apres: r.statut, sfa: r.sfa,
      });
    }
  }

  const sum = (arr: any[]) => arr.reduce((s, x) => s + Number(x.total_ht || 0), 0);
  return {
    first_run: false,
    nouveaux_devis, nouvelles_commandes, changements_statut,
    totaux: {
      nb_nouveaux_devis: nouveaux_devis.length, montant_nouveaux_devis: sum(nouveaux_devis),
      nb_nouvelles_commandes: nouvelles_commandes.length, montant_nouvelles_commandes: sum(nouvelles_commandes),
      nb_changements: changements_statut.length,
    },
  };

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
          mouvements_commerce: {
            type: "object",
            description: "Récap des mouvements commerce de la veille (nouveaux devis, commandes, changements de statut). PAS de marge. Basé UNIQUEMENT sur le bloc mouvements_commerce fourni.",
            properties: {
              resume: { type: "string", description: "Ex '3 nouveaux devis (12 400 € HT), 1 nouvelle commande (8 200 € HT), 2 changements de statut.' ou 'Aucun mouvement commerce hier.' ou 'Récap disponible dès demain.'" },
              lignes: {
                type: "array",
                description: "Lignes compactes 'client — pièce — montant — quoi'. Vide si aucun mouvement ou premier run.",
                items: { type: "string" },
              },
            },
            required: ["resume", "lignes"],
          },
        },
        required: ["resume", "fraicheur", "changements", "alertes_nouvelles", "opportunites", "mouvements_commerce"],
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
- Section briefing.mouvements_commerce : construis-la EXCLUSIVEMENT à partir du bloc mouvements_commerce fourni (jamais des signaux). Si first_run=true → resume="Récap disponible dès demain." et lignes=[]. Sinon si tous les totaux sont à 0 → resume="Aucun mouvement commerce hier." et lignes=[]. Sinon : resume = phrase de synthèse chiffrée des totaux ; lignes = liste compacte groupée par type (devis puis commandes puis changements), format "Client — N°pièce — X € HT — quoi" (ex "ACME — D12345 — 12 400 € HT — nouveau devis", "BETA — CC000200 — 8 200 € HT — nouvelle commande (issue du devis D12300)", "GAMMA — D12200 — 5 000 € HT — Brouillon → Ouvert"). Suffixe " · SFA" si sfa=true. Max 20 lignes. AUCUNE marge, AUCUN coût.
- Réponse : UN SEUL appel à build_sentinelle, sans texte libre.`;


async function callAnthropic(signals: Signal[], fraicheur: string, mouvements: MouvementsCommerce) {
  const userPayload = {
    fraicheur_donnees: fraicheur,
    mouvements_commerce: mouvements,
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
  // Fraîcheur PAR FLUX — chaque source Cegid a son propre dernier succès.
  const FEEDS = ['BD-Clients', 'BD-Ventes', 'BD-Historique', 'BD-Commandes', 'BD-Stock'] as const;
  const perFeed: { feed: string; last: Date | null; ageH: number }[] = [];
  for (const feed of FEEDS) {
    const rows = await safeTable(() =>
      admin.from('gaia_sync_log')
        .select('finished_at, ok, feed')
        .eq('ok', true).eq('feed', feed)
        .order('finished_at', { ascending: false })
        .limit(1) as any
    );
    const last = rows[0]?.finished_at ? new Date(rows[0].finished_at) : null;
    const ageH = last ? (Date.now() - last.getTime()) / 3_600_000 : Infinity;
    perFeed.push({ feed, last, ageH });
  }
  const globalLast = perFeed
    .map((f) => f.last)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const fraicheur = globalLast
    ? `Dernière synchro Cegid réussie : ${globalLast.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}\n` +
      perFeed.map((f) => `  · ${f.feed} : ${f.last ? f.last.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : 'jamais'}`).join('\n')
    : "Fraîcheur des données inconnue (aucun log de synchro trouvé).";

  // Garde-fou : alerte si UN QUELCONQUE flux dépasse 36h — nomme les flux en retard.
  const stale = perFeed.filter((f) => f.ageH > 36);
  if (stale.length > 0) {
    try {
      const noms = stale.map((f) => `${f.feed} (${Number.isFinite(f.ageH) ? Math.round(f.ageH) + 'h' : 'jamais'})`).join(', ');
      const constat = `Flux Cegid en retard (>36h) : ${noms}. La synchro nocturne n'a pas passé ces sources.`;
      const dedupe = 'sync_fresh:stale';
      const { data: exist } = await admin.from('copilot_alertes').select('id, statut').eq('dedupe_key', dedupe).maybeSingle();
      if (exist) {
        await admin.from('copilot_alertes').update({
          titre: `Synchro Cegid — ${stale.length} flux en retard`, constat,
          action_suggeree: 'Ouvrir Réglages → Synchronisation, relancer les flux en retard et vérifier les logs.',
          lien: '/admin/synchronisation', gravite: 'attention',
          updated_at: new Date().toISOString(),
        }).eq('id', exist.id);
      } else {
        await admin.from('copilot_alertes').insert({
          type: 'sync_fresh', gravite: 'attention',
          titre: `Synchro Cegid — ${stale.length} flux en retard`,
          constat, action_suggeree: 'Ouvrir Réglages → Synchronisation, relancer les flux en retard et vérifier les logs.',
          lien: '/admin/synchronisation', visibilite: 'direction',
          dedupe_key: dedupe, statut: 'nouveau',
        });
      }
    } catch (e) {
      console.warn('sync_fresh alert failed:', (e as Error).message);
    }
  }



  // Mouvements commerce d'hier (snapshot + diff) — AVANT collectSignals pour être sûr d'avoir la photo du jour
  const today = new Date().toISOString().slice(0, 10);
  let mouvements: MouvementsCommerce;
  try {
    mouvements = await computeMouvementsCommerce(today);
  } catch (e) {
    console.warn("mouvements_commerce failed:", (e as Error).message);
    mouvements = { first_run: false, nouveaux_devis: [], nouvelles_commandes: [], changements_statut: [],
      totaux: { nb_nouveaux_devis: 0, montant_nouveaux_devis: 0, nb_nouvelles_commandes: 0, montant_nouvelles_commandes: 0, nb_changements: 0 } };
  }

  const signals = await collectSignals();

  let ai: { alertes: any[]; briefing: any };
  try {
    ai = await callAnthropic(signals, fraicheur, mouvements);
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
        mouvements_commerce: mouvements.first_run
          ? { resume: "Récap disponible dès demain.", lignes: [] }
          : { resume: "Récap indisponible (IA injoignable).", lignes: [] },
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

  // ─── Dispatch notifications in-app (Phase 1 gestionnaire) ──────────────
  // Respect visibilité par rôle + préférences par utilisateur (RPC SECURITY DEFINER).
  try {
    // 1. Briefing du matin
    await admin.rpc("dispatch_notification", {
      _type_cle: "briefing_quotidien",
      _titre: `Briefing du jour`,
      _corps: ai.briefing?.resume ?? null,
      _lien: "/",
      _gravite: "info",
      _dedupe_key: `briefing:${today}`,
      _meta: {},
    });

    // 2. Alertes regroupées par type_cle (une notif par type/jour)
    const byType: Record<string, any[]> = {};
    for (const a of ai.alertes ?? []) {
      const key = String(a.type || "").trim();
      if (!key) continue;
      (byType[key] ??= []).push(a);
    }
    for (const [typeCle, list] of Object.entries(byType)) {
      const first = list[0];
      const nb = list.length;
      const anyUrgent = list.some((a) => a.gravite === "urgent");
      const titre = nb === 1 ? first.titre : `${nb} alertes : ${first.titre}`;
      const corps = nb === 1
        ? first.constat
        : list.slice(0, 3).map((a) => `• ${a.titre} — ${a.constat}`).join("\n") +
          (nb > 3 ? `\n… et ${nb - 3} autres.` : "");
      await admin.rpc("dispatch_notification", {
        _type_cle: typeCle,
        _titre: titre,
        _corps: corps,
        _lien: first.lien ?? null,
        _gravite: anyUrgent ? "urgent" : (first.gravite ?? null),
        _dedupe_key: `${typeCle}:${today}`,
        _meta: { nb },
      });
    }

    // 3. Veille publiée (si un rapport frais existe)
    const veilleLast = await safeTable(() =>
      admin.from("veille_rapports").select("created_at").order("created_at", { ascending: false }).limit(1) as any
    );
    const lastVeilleAt = (veilleLast[0] as any)?.created_at;
    if (lastVeilleAt && (Date.now() - new Date(lastVeilleAt).getTime()) < 26 * 3600 * 1000) {
      await admin.rpc("dispatch_notification", {
        _type_cle: "veille_publiee",
        _titre: "Nouvelle veille marché publiée",
        _corps: "Un nouveau rapport de veille est disponible.",
        _lien: "/admin/veille",
        _gravite: "info",
        _dedupe_key: `veille:${String(lastVeilleAt).slice(0, 10)}`,
        _meta: {},
      });
    }
  } catch (e) {
    console.warn("dispatch notifications failed:", (e as Error).message);
  }

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
