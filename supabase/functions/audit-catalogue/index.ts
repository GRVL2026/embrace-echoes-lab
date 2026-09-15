// Audit d'hygiène du catalogue Shopify — champ `custom.specs_dimensions`.
//
// Ce champ est saisi à la main. Relevé sur les 350 produits actifs : treize écritures
// différentes, dont le séparateur « × », le séparateur « * », des espaces manquants, des
// axes sans libellé, des intervalles, et une notation centimètres nue pour les accessoires.
// Des cotes fausses se propagent partout : Arcade Planner, devis, dossiers commerciaux.
//
// PRINCIPE DE CONCEPTION (appris en confrontant une première version au vrai catalogue) :
// ne JAMAIS s'appuyer sur `productType` ni sur les `tags` pour décider qui doit avoir des
// cotes. Shopify les type mal — « Bouton flipper », « Articulation à méplat » et
// « Stern Street Sign » sont tous classés productType « Flippers ». Une première version
// fondée sur un seuil unique produisait 148 lignes dont 145 fausses : le rapport serait
// devenu illisible, donc ignoré, donc inutile.
//
// Deux mécanismes le remplacent, tous deux auto-cohérents :
//   1. la NOTATION classe la fiche. Vérifié sur les 350 produits : la forme explicite
//      « L … x P … x H … mm » n'est employée que par les machines et la monétique ; la forme
//      nue « 72x26x28 » (centimètres) n'est employée que par les accessoires Stern. La bande
//      de plausibilité découle donc de l'écriture, sans taxonomie à maintenir.
//   2. une cote absente n'est signalée que si la fiche technique est COMMENCÉE, c'est-à-dire
//      si un autre `custom.specs_*` est rempli. Un bouton de flipper n'a aucune spec : silence.
//      « Angry Birds Fury Road » a capacité, tickets et liaison mais pas de cotes : signalé.
//
// Déclenchement : cron `pg_cron` (en-tête `x-cron-secret`) ou appel authentifié.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyser, GRAVITE, incoherencesVariantes } from "./analyse.ts";

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

const REQUETE = `
  query($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      edges {
        cursor
        node {
          id title handle status
          metafields(namespace: "custom", first: 50) { nodes { key value } }
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

    const horodatage = new Date().toISOString();
    const lignes: any[] = [];
    const saines: { titre: string; largeur?: number; profondeur?: number }[] = [];
    let notationCm = 0;

    for (const p of produits) {
      const champs: Record<string, string> = {};
      for (const m of p.metafields?.nodes ?? []) champs[m.key] = m.value;
      const brut = champs["specs_dimensions"] ?? null;
      // « La fiche technique est-elle commencée ? » — un autre specs_* rempli suffit.
      const specsVoisines = Object.entries(champs).some(
        ([k, v]) => k.startsWith("specs_") && k !== "specs_dimensions" && v && v.trim() !== "",
      );

      const a = analyser(brut, specsVoisines);
      if (a.notation === "cm") notationCm++;
      if (!a.anomalie) {
        saines.push({ titre: p.title, largeur: a.largeur, profondeur: a.profondeur });
        continue;
      }
      lignes.push({
        shopify_id: p.id,
        titre: p.title,
        handle: p.handle,
        statut: p.status,
        valeur_brute: brut,
        notation: a.notation,
        anomalie: a.anomalie,
        gravite: GRAVITE[a.anomalie] ?? "cosmetique",
        detail: a.detail,
        largeur_mm: a.largeur ?? null,
        profondeur_mm: a.profondeur ?? null,
        hauteur_mm: a.hauteur ?? null,
        vu_le: horodatage,
      });
    }

    // Cohérence des variantes : ne porte que sur les fiches par ailleurs saines, sinon on
    // comparerait des cotes déjà connues comme fausses.
    for (const inc of incoherencesVariantes(saines)) {
      const p = produits.find((x) => x.title === inc.titre);
      const f = saines.find((x) => x.titre === inc.titre)!;
      lignes.push({
        shopify_id: p?.id ?? inc.titre,
        titre: inc.titre,
        handle: p?.handle ?? null,
        statut: p?.status ?? null,
        valeur_brute: (p?.metafields?.nodes ?? []).find((m: any) => m.key === "specs_dimensions")?.value ?? null,
        notation: "mm",
        anomalie: "incoherence_variante",
        gravite: GRAVITE.incoherence_variante,
        detail: inc.detail,
        largeur_mm: f.largeur ?? null,
        profondeur_mm: f.profondeur ?? null,
        hauteur_mm: null,
        vu_le: horodatage,
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
      bloquantes: lignes.filter((l) => l.gravite === "bloquant").length,
      cosmetiques: lignes.filter((l) => l.gravite === "cosmetique").length,
      par_type: parType,
      fiches_notation_centimetres: notationCm,
    });
  } catch (e) {
    console.error("audit-catalogue :", e);
    return j(500, { error: e instanceof Error ? e.message : "erreur inconnue" });
  }
});
