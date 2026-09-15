// Audit d'hygiène du catalogue Shopify — champ `custom.specs_dimensions`.
//
// Ce champ est saisi à la main et douze formats différents ont été relevés en production.
// Des cotes fausses ou illisibles se propagent partout : Arcade Planner, devis, dossiers
// commerciaux. Cette fonction les détecte et les consigne dans `catalogue_anomalies`.
//
// Déclenchement : cron `pg_cron` (en-tête `x-cron-secret`) ou appel authentifié.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SHOPIFY_STORE = "zhx0nb-11.myshopify.com";
const API_VERSION = "2025-01";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const MIN_MM = 200;      // 20 cm — en dessous, ce n'est pas une machine
const MAX_MM = 10000;    // 10 m  — au dessus non plus

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function autorise(req: Request): Promise<boolean> {
  if (CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET) return true;
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data?.user;
}

type Analyse = {
  largeur?: number; profondeur?: number; hauteur?: number;
  anomalie: string | null;      // null = fiche saine
  detail: string | null;
};

/** Parseur des 12 variantes relevées en production.
 *  Principe : chercher CHAQUE axe par sa lettre, indépendamment — l'ordre n'a alors plus
 *  d'importance et une inversion L/P dans l'écriture ne fausse rien. */
export function analyser(brut: string | null | undefined): Analyse {
  if (!brut || !brut.trim()) {
    return { anomalie: "manquant", detail: "aucune valeur renseignée" };
  }
  const s = brut.replace(/×/g, "x").trim();   // × (U+00D7) -> x

  if (!/\d/.test(s)) {
    return { anomalie: "illisible", detail: `aucun chiffre : « ${brut.trim()} »` };
  }

  const axes: Record<string, number> = {};
  let intervalle = false;
  for (const [lettre, cle] of [["L", "largeur"], ["P", "profondeur"], ["H", "hauteur"]] as const) {
    const m = s.match(new RegExp(`\\b${lettre}\\s*(\\d+(?:[.,]\\d+)?)(\\s*/\\s*(\\d+(?:[.,]\\d+)?))?`, "i"));
    if (!m) continue;
    const nombres = (m[0].match(/\d+(?:[.,]\d+)?/g) || []).map((v) => parseFloat(v.replace(",", ".")));
    if (nombres.length > 1) intervalle = true;
    axes[cle] = Math.max(...nombres);
  }

  // Repli : format nu « 72x26x28 », utilisé pour les accessoires — en CENTIMÈTRES.
  if (Object.keys(axes).length === 0) {
    const nu = s.match(/^\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (nu) {
      const [a, b, c] = [nu[1], nu[2], nu[3]].map((v) => parseFloat(v.replace(",", ".")) * 10);
      return {
        largeur: a, profondeur: b, hauteur: c,
        anomalie: "unite_implicite",
        detail: "format nu sans libellé ni unité — interprété en centimètres (accessoire ?)",
      };
    }
    return { anomalie: "illisible", detail: `format non reconnu : « ${brut.trim()} »` };
  }

  const manquants = (["largeur", "profondeur", "hauteur"] as const).filter((k) => axes[k] === undefined);
  const hors = Object.entries(axes).filter(([, v]) => v < MIN_MM || v > MAX_MM);

  const base = { largeur: axes.largeur, profondeur: axes.profondeur, hauteur: axes.hauteur };

  if (manquants.length) {
    return { ...base, anomalie: "axe_manquant", detail: `axe(s) sans libellé : ${manquants.join(", ")}` };
  }
  if (hors.length) {
    return { ...base, anomalie: "hors_plage",
      detail: hors.map(([k, v]) => `${k} = ${v} mm`).join(", ") + ` (attendu ${MIN_MM}–${MAX_MM} mm)` };
  }
  if (intervalle) {
    return { ...base, anomalie: "intervalle",
      detail: "une cote est donnée comme intervalle — la valeur haute est retenue, à confirmer" };
  }
  // Ordre d'écriture inhabituel : signalé pour vérification humaine, pas bloquant.
  const iL = s.search(/\bL\s*\d/i), iP = s.search(/\bP\s*\d/i);
  if (iL >= 0 && iP >= 0 && iP < iL) {
    return { ...base, anomalie: "ordre_inhabituel",
      detail: "« P » est écrit avant « L » : le parseur lit correctement, mais vérifier que les libellés ne sont pas intervertis" };
  }
  return { ...base, anomalie: null, detail: null };
}

const REQUETE = `
  query($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      edges {
        cursor
        node {
          id title handle status
          metafield(namespace: "custom", key: "specs_dimensions") { value }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!(await autorise(req))) return j(401, { error: "non autorisé" });

  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!token) return j(500, { error: "SHOPIFY_ACCESS_TOKEN absent" });

  try {
    const produits: any[] = [];
    let cursor: string | null = null;
    let encore = true;
    while (encore) {
      const r = await fetch(`https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: REQUETE, variables: { cursor } }),
      });
      if (!r.ok) throw new Error(`Shopify [${r.status}] ${await r.text()}`);
      const d = await r.json();
      if (d.errors) throw new Error(`GraphQL : ${d.errors.map((e: any) => e.message).join(", ")}`);
      for (const e of d.data.products.edges) produits.push(e.node);
      encore = d.data.products.pageInfo.hasNextPage;
      cursor = d.data.products.pageInfo.endCursor;
    }

    const lignes = [];
    for (const p of produits) {
      const a = analyser(p.metafield?.value);
      if (!a.anomalie) continue;
      lignes.push({
        shopify_id: p.id,
        titre: p.title,
        handle: p.handle,
        statut: p.status,
        valeur_brute: p.metafield?.value ?? null,
        anomalie: a.anomalie,
        detail: a.detail,
        largeur_mm: a.largeur ?? null,
        profondeur_mm: a.profondeur ?? null,
        hauteur_mm: a.hauteur ?? null,
        vu_le: new Date().toISOString(),
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    // On repart d'une table propre : une fiche corrigée doit disparaître du rapport.
    const { error: eDel } = await sb.from("catalogue_anomalies").delete().neq("shopify_id", "");
    if (eDel) throw eDel;
    if (lignes.length) {
      const { error: eIns } = await sb.from("catalogue_anomalies").insert(lignes);
      if (eIns) throw eIns;
    }

    const parType: Record<string, number> = {};
    for (const l of lignes) parType[l.anomalie] = (parType[l.anomalie] ?? 0) + 1;

    return j(200, {
      ok: true,
      produits_actifs: produits.length,
      anomalies: lignes.length,
      par_type: parType,
    });
  } catch (e) {
    console.error("audit-catalogue :", e);
    return j(500, { error: e instanceof Error ? e.message : "erreur inconnue" });
  }
});
