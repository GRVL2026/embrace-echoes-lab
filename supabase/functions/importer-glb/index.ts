// Importe des GLB reconstruits (Hunyuan3D) dans Arcade OS, côté serveur :
// télécharge chaque GLB depuis son URL, l'upload dans le bucket "models-3d" (service_role),
// et rattache la fiche produit (catalog_products.model3d, par NOM).
// Appelée par la page /admin/reconstruction-3d. Réservé au management. Aucune clé côté client.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireRole } from "../_shared/require-role.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const slug = (s: string) =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireRole(req, ["admin", "direction", "chef_ventes"]);
  if (!gate.ok) return gate.response;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return j({ ok: false, error: "Aucun modèle à importer." });

  const results: any[] = [];
  for (const it of items) {
    try {
      if (!it?.name || !it?.url) throw new Error("name et url requis");
      const r = await fetch(it.url);
      if (!r.ok) throw new Error(`téléchargement GLB ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const path = `reconstruits/${slug(it.name)}.glb`;
      const up = await admin.storage.from("models-3d").upload(path, bytes, {
        contentType: "model/gltf-binary", upsert: true,
      });
      if (up.error) throw up.error;
      const pub = admin.storage.from("models-3d").getPublicUrl(path).data.publicUrl;
      const upd = await admin.from("catalog_products")
        .update({ model3d: pub, model3d_rotation: it.rotation ?? 0 })
        .eq("name", it.name).select("id");
      if (upd.error) throw upd.error;
      results.push({ name: it.name, ok: true, fiches: upd.data?.length ?? 0, url: pub });
    } catch (e: any) {
      results.push({ name: it.name, ok: false, error: e?.message || String(e) });
    }
  }
  return j({ ok: true, results });
});
