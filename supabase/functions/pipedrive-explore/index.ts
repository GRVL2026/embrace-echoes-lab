// Test de connexion + exploration de la structure Pipedrive.
//
// Lit PIPEDRIVE_API_TOKEN + PIPEDRIVE_DOMAIN (secrets Supabase) et renvoie : société,
// commerciaux actifs, pipelines, étapes. Sert à (1) vérifier que le jeton marche et
// (2) découvrir la config réelle avant de construire le push et le briefing.
//
// Réservé admin/direction. Le jeton reste côté serveur (jamais renvoyé au front).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireRole } from "../_shared/require-role.ts";

const TOKEN = Deno.env.get("PIPEDRIVE_API_TOKEN") ?? "";
const RAW_DOMAIN = Deno.env.get("PIPEDRIVE_DOMAIN") ?? "";

/** Normalise le domaine : "avranches", "avranches.pipedrive.com" ou une URL → base API. */
function apiBase(): string {
  let d = RAW_DOMAIN.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!d) return "";
  if (!d.includes(".")) d = `${d}.pipedrive.com`;
  return `https://${d}/api/v1`;
}

/** Ne garde que les champs PERSONNALISÉS (edit_flag=true) et les décrit simplement. */
function champsPerso(fields: any): any[] {
  return ((fields ?? []) as any[])
    .filter((f) => f?.edit_flag === true)
    .map((f) => ({
      nom: f.name,
      cle: f.key,
      type: f.field_type,
      options: Array.isArray(f.options) ? f.options.map((o: any) => o.label) : undefined,
    }));
}

async function pd(path: string): Promise<any> {
  const base = apiBase();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${base}${path}${sep}api_token=${encodeURIComponent(TOKEN)}`);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* réponse non-JSON */ }
  if (!res.ok || json?.success === false) {
    const detail = json?.error ?? text.slice(0, 200);
    throw new Error(`HTTP ${res.status} sur ${path} — ${detail}`);
  }
  return json?.data ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireRole(req, ["admin", "direction"]);
  if (!gate.ok) return gate.response;

  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!TOKEN || !RAW_DOMAIN) {
    return json({
      ok: false,
      error: "Secrets manquants. Ajoute PIPEDRIVE_API_TOKEN et PIPEDRIVE_DOMAIN dans les secrets Supabase (Edge Functions).",
    });
  }

  try {
    const me = await pd("/users/me");
    const [users, pipelines, stages, dealFields, personFields, orgFields] = await Promise.all([
      pd("/users"),
      pd("/pipelines"),
      pd("/stages"),
      pd("/dealFields"),
      pd("/personFields"),
      pd("/organizationFields"),
    ]);
    return json({
      ok: true,
      societe: {
        nom: me?.company_name ?? null,
        domaine: me?.company_domain ?? null,
        connecte_en_tant_que: me?.name ?? null,
      },
      commerciaux: ((users ?? []) as any[])
        .filter((u) => u.active_flag)
        .map((u) => ({ id: u.id, nom: u.name, email: u.email })),
      pipelines: ((pipelines ?? []) as any[]).map((p) => ({ id: p.id, nom: p.name })),
      etapes: ((stages ?? []) as any[])
        .map((s) => ({ id: s.id, nom: s.name, pipeline_id: s.pipeline_id, ordre: s.order_nr }))
        .sort((a, b) => (a.pipeline_id - b.pipeline_id) || (a.ordre - b.ordre)),
      champs: {
        deal: champsPerso(dealFields),
        person: champsPerso(personFields),
        organization: champsPerso(orgFields),
      },
    });
  } catch (e: any) {
    return json({
      ok: false,
      error: e?.message || String(e),
      indice: "Vérifie le jeton (Pipedrive → préférences perso → API) et le domaine (ex. avranches.pipedrive.com).",
    });
  }
});
