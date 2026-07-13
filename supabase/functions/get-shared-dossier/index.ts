import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    if (!slug) {
      return new Response(JSON.stringify({ error: "slug requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: project, error: pErr } = await admin
      .from("projects")
      .select(
        "id, client_name, brand_id, offer, selected_modules, selected_products, pricing, context, solution, scope, plan_data, status, share_slug, is_shared",
      )
      .eq("share_slug", slug)
      .eq("is_shared", true)
      .maybeSingle();

    if (pErr || !project) {
      return new Response(JSON.stringify({ error: "Dossier introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Brand
    let brand: any = null;
    if (project.brand_id) {
      const { data: b } = await admin
        .from("brands")
        .select("id, name, tagline, color, accent, logo_url, contact")
        .eq("id", project.brand_id)
        .maybeSingle();
      brand = b ?? null;
    }

    // Modules — preserve order from selected_modules
    const moduleIds: string[] = Array.isArray(project.selected_modules) ? project.selected_modules : [];
    let modules: any[] = [];
    if (moduleIds.length > 0) {
      const { data: mods } = await admin
        .from("brand_modules")
        .select("id, image_url, title, subtitle")
        .in("id", moduleIds);
      const byId = new Map<string, any>();
      for (const m of mods ?? []) byId.set(m.id, m);
      modules = moduleIds.map((id) => byId.get(id)).filter(Boolean);
    }

    // Products — enrich with catalog info, keep qty/unit_price
    const selected: any[] = Array.isArray(project.selected_products) ? project.selected_products : [];
    const productIds = Array.from(new Set(selected.map((x) => x?.product_id).filter((x: any) => !!x)));
    const catalog: Record<string, { id: string; name: string | null; images: string[] | null; product_url: string | null }> = {};
    if (productIds.length > 0) {
      const { data: cp } = await admin
        .from("catalog_products")
        .select("id, name, images, product_url")
        .in("id", productIds);
      for (const c of cp ?? []) catalog[c.id] = c as any;
    }
    const products = selected.map((s) => {
      const c = s?.product_id ? catalog[s.product_id] : null;
      return {
        product_id: s?.product_id ?? null,
        name: s?.name ?? c?.name ?? "",
        qty: s?.qty ?? 1,
        unit_price: s?.unit_price ?? 0,
        image: c?.images?.[0] ?? null,
        product_url: c?.product_url ?? null,
      };
    });

    // Do NOT expose share_token or owner ids
    const safeProject = {
      id: project.id,
      client_name: project.client_name,
      brand_id: project.brand_id,
      offer: project.offer,
      selected_modules: project.selected_modules,
      selected_products: project.selected_products,
      pricing: project.pricing,
      context: project.context,
      solution: project.solution,
      scope: project.scope,
      plan_data: project.plan_data,
      status: project.status,
      share_slug: project.share_slug,
      is_shared: project.is_shared,
    };

    return new Response(
      JSON.stringify({ project: safeProject, brand, modules, products }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message ?? "Erreur serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
