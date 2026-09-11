// Lecture des affaires (deals) Pipedrive pour le cockpit prospection.
//
// Deux modes :
//  - LISTE (défaut) : renvoie le pipe d'un pipeline (JEUX par défaut) regroupé par étape,
//    + la liste des commerciaux et des pipelines pour les 2 menus déroulants.
//  - DÉTAIL (?deal_id=123) : renvoie une affaire + ses activités + son contenu (produits/proforma).
//
// Cloisonnement : admin/direction/chef_ventes voient tout le monde et peuvent choisir un
// commercial ; un commercial ne voit QUE ses affaires (owner forcé côté serveur par email).
// Le jeton Pipedrive reste côté serveur (jamais renvoyé au front).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireRole } from "../_shared/require-role.ts";

const TOKEN = Deno.env.get("PIPEDRIVE_API_TOKEN") ?? "";
const RAW_DOMAIN = Deno.env.get("PIPEDRIVE_DOMAIN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MANAGEMENT = ["admin", "direction", "chef_ventes"];
const DEFAULT_PIPELINE = "JEUX";

function apiBase(): string {
  let d = RAW_DOMAIN.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!d) return "";
  if (!d.includes(".")) d = `${d}.pipedrive.com`;
  return `https://${d}/api/v1`;
}

/** Appel Pipedrive renvoyant l'objet complet (data + additional_data pour la pagination). */
async function pdRaw(path: string): Promise<any> {
  const base = apiBase();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${base}${path}${sep}api_token=${encodeURIComponent(TOKEN)}`);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok || json?.success === false) {
    const detail = json?.error ?? text.slice(0, 200);
    throw new Error(`HTTP ${res.status} sur ${path} — ${detail}`);
  }
  return json ?? {};
}
async function pd(path: string): Promise<any> {
  return (await pdRaw(path))?.data ?? null;
}

/** Récupère toutes les pages d'une collection paginée (deals, activités…), plafonnée. */
async function pdAll(path: string, cap = 1000): Promise<any[]> {
  const out: any[] = [];
  let start = 0;
  const limit = 500;
  for (let i = 0; i < 6; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const json = await pdRaw(`${path}${sep}start=${start}&limit=${limit}`);
    const rows = (json?.data ?? []) as any[];
    out.push(...rows);
    const pag = json?.additional_data?.pagination;
    if (!pag?.more_items_in_collection || out.length >= cap) break;
    start = pag.next_start ?? start + limit;
  }
  return out;
}

const eur = (n: any) => Number(n) || 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Auth : tout rôle commercial/management authentifié.
  const gate = await requireRole(req, ["admin", "direction", "chef_ventes", "commercial", "prospection"]);
  if (!gate.ok) return gate.response;

  if (!TOKEN || !RAW_DOMAIN) {
    return json({ ok: false, error: "Secrets Pipedrive manquants (PIPEDRIVE_API_TOKEN / PIPEDRIVE_DOMAIN)." });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Rôle + email de l'appelant.
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", gate.userId),
      admin.from("profiles").select("email, full_name").eq("id", gate.userId).maybeSingle(),
    ]);
    const roles = (roleRows ?? []).map((r: any) => r.role);
    const isManagement = roles.some((r: string) => MANAGEMENT.includes(r));
    const myEmail = (profile?.email ?? "").trim().toLowerCase();

    // Commerciaux Pipedrive (pour le mapping email ⇄ owner et le menu déroulant).
    const users = ((await pd("/users")) ?? []) as any[];
    const actifs = users.filter((u) => u.active_flag);
    const emailToId = new Map<string, number>();
    actifs.forEach((u) => { if (u.email) emailToId.set(String(u.email).trim().toLowerCase(), u.id); });
    const myPipedriveId = myEmail ? emailToId.get(myEmail) ?? null : null;

    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const p = (k: string) => body?.[k] ?? url.searchParams.get(k) ?? null;

    // ---- Résolution du propriétaire demandé (avec cloisonnement) ----
    // Management : peut demander un owner précis, 'me', ou 'all'. Commercial : forcé sur le sien.
    let ownerId: number | null = null;      // null = tous (management uniquement)
    let ownerForced = false;
    if (isManagement) {
      const req_owner = p("owner");
      if (req_owner && req_owner !== "all") {
        ownerId = req_owner === "me" ? myPipedriveId : Number(req_owner);
      }
    } else {
      ownerForced = true;
      if (!myPipedriveId) {
        return json({
          ok: true, isManagement: false, ownerForced: true, mapped: false,
          note: "Ton compte Arcade OS n'est pas encore relié à un utilisateur Pipedrive (email non trouvé).",
          pipeline: null, pipelines: [], stages: [], commerciaux: [], deals: [],
        });
      }
      ownerId = myPipedriveId;
    }

    // ---- Résolution du pipeline (JEUX par défaut) ----
    const pipelines = ((await pd("/pipelines")) ?? []) as any[];
    const wantPipeline = (p("pipeline") ?? DEFAULT_PIPELINE).toString().toLowerCase();
    const wantPipelineId = p("pipeline_id");
    const pipeline =
      (wantPipelineId && pipelines.find((pl) => String(pl.id) === String(wantPipelineId))) ||
      pipelines.find((pl) => String(pl.name).toLowerCase() === wantPipeline) ||
      pipelines.find((pl) => String(pl.name).toLowerCase().includes(wantPipeline)) ||
      pipelines[0];
    if (!pipeline) return json({ ok: false, error: "Aucun pipeline trouvé sur ce compte Pipedrive." });

    const stagesRaw = ((await pd(`/stages?pipeline_id=${pipeline.id}`)) ?? []) as any[];
    const stages = stagesRaw
      .map((s) => ({ id: s.id, nom: s.name, ordre: s.order_nr }))
      .sort((a, b) => a.ordre - b.ordre);

    const pipelinesOut = pipelines.map((pl) => ({ id: pl.id, nom: pl.name }));
    const commerciauxOut = isManagement
      ? actifs.map((u) => ({ id: u.id, nom: u.name, email: u.email }))
      : [];

    // ---- MODE DÉTAIL ----
    const dealId = p("deal_id");
    if (dealId) {
      const deal = await pd(`/deals/${dealId}`);
      if (!deal) return json({ ok: false, error: "Affaire introuvable." });
      // Cloisonnement : un commercial ne peut ouvrir qu'une de ses affaires.
      if (ownerForced && deal.user_id?.value !== myPipedriveId && deal.user_id !== myPipedriveId) {
        return json({ ok: false, error: "Accès refusé à cette affaire." }, 403);
      }
      const [acts, products] = await Promise.all([
        pdAll(`/deals/${dealId}/activities`, 30),
        pd(`/deals/${dealId}/products`).catch(() => []),
      ]);
      const ownerName = deal.user_id?.name ?? deal.owner_name ?? null;
      return json({
        ok: true,
        mode: "detail",
        deal: {
          id: deal.id, titre: deal.title, valeur: eur(deal.value), devise: deal.currency,
          etape_id: deal.stage_id, statut: deal.status, owner_id: deal.user_id?.value ?? deal.user_id,
          owner_nom: ownerName,
          organisation: deal.org_id?.name ?? null, personne: deal.person_id?.name ?? null,
          ajoute_le: deal.add_time, maj_le: deal.update_time,
          activites_faites: deal.done_activities_count, activites_a_faire: deal.undone_activities_count,
          derniere_activite: deal.last_activity_date, prochaine_activite: deal.next_activity_date,
        },
        activites: (acts ?? []).slice(0, 20).map((a: any) => ({
          type: a.type, sujet: a.subject, faite: a.done, date: a.due_date || a.marked_as_done_time || a.add_time, note: a.note,
        })),
        produits: (products ?? []).map((pr: any) => ({
          nom: pr.name, quantite: pr.quantity, prix: eur(pr.item_price), total: eur(pr.sum),
        })),
      });
    }

    // ---- MODE LISTE ----
    let path = `/pipelines/${pipeline.id}/deals?status=open`;
    if (ownerId != null) path += `&user_id=${ownerId}`;
    else path += `&everyone=1`; // management "Tous" : toutes les affaires, pas seulement celles du jeton
    const dealsRaw = await pdAll(path, 1000);
    const deals = dealsRaw.map((d: any) => ({
      id: d.id, titre: d.title, valeur: eur(d.value), devise: d.currency,
      etape_id: d.stage_id, owner_id: d.user_id?.value ?? d.user_id, owner_nom: d.user_id?.name ?? null,
      organisation: d.org_id?.name ?? d.org_name ?? null, personne: d.person_id?.name ?? d.person_name ?? null,
      maj_le: d.update_time, ville: d["ville"] ?? null,
      activites_a_faire: d.undone_activities_count ?? 0, prochaine_activite: d.next_activity_date,
    }));

    return json({
      ok: true,
      mode: "liste",
      isManagement,
      ownerForced,
      owner_id: ownerId,
      pipeline: { id: pipeline.id, nom: pipeline.name },
      pipelines: pipelinesOut,
      stages,
      commerciaux: commerciauxOut,
      deals,
      total: deals.length,
      valeur_totale: deals.reduce((s, d) => s + d.valeur, 0),
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) });
  }
});
