// =====================================================================
// generate-dossier — Dossier Copilot
// Reçoit un brief commercial en langage naturel + le plan en cours,
// interroge le catalogue et les modules marque, et renvoie un brouillon
// de dossier structuré généré par Claude (API Anthropic directe).
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-sonnet-5"; // équilibre vitesse/intelligence ; passer à claude-opus-4-8 si besoin

const SYSTEM_PROMPT = `Tu es l'assistant commercial d'Avranches Automatic, distributeur de bornes d'arcade, flippers (revendeur officiel Stern) et distributeurs automatiques (blind boxes, figurines, TCG).

TARIFICATION — RÈGLE ABSOLUE :
- price_erp_ht = prix de vente HT fiable issu de l'ERP Cegid, à utiliser EN PRIORITÉ pour le chiffrage en 'vente'.
- price = prix TTC indicatif du site web, à n'utiliser qu'en dernier recours si price_erp_ht est absent.
- price_monthly = loyer mensuel (utilisé en 'location' ou 'leasing').

À partir du brief d'un commercial (souvent bref et informel), tu produis le BROUILLON d'un dossier client, que l'équipe affinera ensuite. Tu dois :
- Reformuler le contexte et le besoin du client de façon professionnelle.
- Sélectionner dans le CATALOGUE fourni les produits les plus pertinents selon le lieu, le public, la surface et le budget. N'invente jamais de produit : n'utilise que des product_id présents dans le catalogue.
- Choisir parmi les MODULES MARQUE fournis ceux à inclure (société Avranches, et Funtime ou Hypernova si le projet s'y prête). N'utilise que des module_id fournis.
- Proposer un chiffrage cohérent : en 'vente' utilise price_erp_ht en priorité (fiable), et seulement à défaut price ; en 'location' ou 'leasing' utilise price_monthly. Si un prix manque, mets 0 et signale-le dans le résumé.
- Rester factuel et sobre. Répondre en français.

Tu réponds UNIQUEMENT en appelant l'outil build_dossier.`;

const TOOL = {
  name: "build_dossier",
  description: "Construit le brouillon structuré du dossier client.",
  input_schema: {
    type: "object",
    properties: {
      client_name: { type: "string" },
      offer: { type: "string", enum: ["vente", "location", "leasing"] },
      context: {
        type: "object",
        properties: {
          contexte: { type: "string" },
          objectif: { type: "string" },
          enjeux: { type: "string" },
          lecture: { type: "string", description: "Comment Avranches répond au besoin" },
        },
        required: ["contexte", "objectif", "enjeux", "lecture"],
      },
      solution: {
        type: "object",
        properties: {
          selection: { type: "string" },
          deploiement: { type: "string" },
          suivi: { type: "string" },
        },
        required: ["selection", "deploiement", "suivi"],
      },
      recommended_products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            product_id: { type: "string" },
            name: { type: "string" },
            qty: { type: "number" },
            unit_price: { type: "number" },
            reason: { type: "string" },
          },
          required: ["product_id", "name", "qty"],
        },
      },
      module_ids: { type: "array", items: { type: "string" } },
      scope: {
        type: "object",
        properties: {
          fourniture: { type: "boolean" },
          livraison: { type: "boolean" },
          formation: { type: "boolean" },
          garantie: { type: "boolean" },
        },
      },
      pricing: {
        type: "object",
        properties: {
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                qty: { type: "number" },
                amount: { type: "number" },
              },
              required: ["label", "amount"],
            },
          },
          total_ht: { type: "number" },
          monthly: { type: "number" },
        },
      },
      summary: { type: "string", description: "1-2 phrases pour le commercial : ce qui a été proposé et les points à vérifier." },
    },
    required: ["client_name", "offer", "context", "solution", "recommended_products", "module_ids", "summary"],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { brief, offer = "vente", brand_key, room_context, client_name } = await req.json();
    if (!brief || typeof brief !== "string") {
      return json({ error: "brief manquant" }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY non configurée" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Sources : catalogue + modules marque ---
    const [{ data: products }, { data: modules }] = await Promise.all([
      supabase.from("catalog_products")
        .select("id,name,category,width,depth,height,price,price_monthly,description,vendor")
        .eq("active", true),
      supabase.from("brand_modules")
        .select("id,type,title,subtitle,brand_id,brands(key,name)")
        .eq("is_active", true).eq("reusable", true).order("position"),
    ]);

    const catalogText = (products ?? []).map((p) =>
      `#${p.id} | ${p.name} | ${p.category} | ${p.width}x${p.depth}x${p.height}cm | vente ${p.price ?? "?"}€ | loc ${p.price_monthly ?? "?"}€/mois | ${p.vendor ?? ""} — ${(p.description ?? "").slice(0, 140)}`
    ).join("\n");

    const modulesText = (modules ?? []).map((m: any) =>
      `#${m.id} | ${m.brands?.key} | ${m.type} | ${m.title ?? ""} — ${m.subtitle ?? ""}`
    ).join("\n");

    const userContent =
      `BRIEF DU COMMERCIAL :\n${brief}\n\n` +
      `TYPE D'OFFRE VISÉ : ${offer}\n` +
      (client_name ? `CLIENT : ${client_name}\n` : "") +
      (brand_key ? `MARQUE À METTRE EN AVANT : ${brand_key}\n` : "") +
      (room_context ? `PLAN EN COURS (contexte spatial) :\n${JSON.stringify(room_context)}\n` : "") +
      `\nCATALOGUE DISPONIBLE (utilise ces product_id uniquement) :\n${catalogText || "(vide)"}\n\n` +
      `MODULES MARQUE DISPONIBLES (utilise ces module_id uniquement) :\n${modulesText || "(vide)"}`;

    // --- Appel Claude (API Anthropic) ---
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "build_dossier" },
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!aiResp.ok) {
      const body = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, body);
      return json({ error: "Erreur du modèle", detail: body }, 502);
    }

    const data = await aiResp.json();
    const toolUse = (data.content ?? []).find((b: any) => b.type === "tool_use");
    if (!toolUse) return json({ error: "Réponse du modèle sans dossier structuré" }, 502);

    return json({ dossier: toolUse.input });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
