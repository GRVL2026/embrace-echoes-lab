// Serves an HTML page with Open Graph meta tags for a shared dossier,
// so link previews (WhatsApp, iMessage, Slack, email…) render a rich card.
// Regular users get an immediate JS redirect to the SPA route /d/:slug.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_ORIGIN = Deno.env.get("APP_PUBLIC_URL") ?? "https://embrace-echoes-lab.lovable.app";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    // Path shape: /functions/v1/dossier-og/<slug>  OR  ?slug=<slug>
    const parts = url.pathname.split("/").filter(Boolean);
    const slugFromPath = parts[parts.length - 1];
    const slug = (url.searchParams.get("slug") ?? slugFromPath ?? "").trim();
    if (!slug || slug === "dossier-og") {
      return new Response("Not found", { status: 404 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: project } = await admin
      .from("projects")
      .select("id, client_name, brand_id, selected_modules, is_shared, share_slug")
      .eq("share_slug", slug)
      .eq("is_shared", true)
      .maybeSingle();

    const targetUrl = `${APP_ORIGIN}/d/${encodeURIComponent(slug)}`;

    let title = "Dossier commercial — Avranches Automatic";
    let description = "Découvrez votre proposition sur-mesure.";
    let image: string | null = null;

    if (project) {
      const clientName = (project.client_name ?? "").toString().trim();
      title = clientName ? `Dossier ${clientName} — Avranches Automatic` : title;
      description = clientName
        ? `Proposition commerciale personnalisée pour ${clientName}.`
        : description;

      // Try first module image as og:image
      const moduleIds: string[] = Array.isArray(project.selected_modules) ? project.selected_modules : [];
      if (moduleIds.length > 0) {
        const { data: mods } = await admin
          .from("brand_modules")
          .select("id, image_url")
          .in("id", moduleIds);
        const byId = new Map<string, string | null>();
        for (const m of mods ?? []) byId.set(m.id, (m as any).image_url ?? null);
        for (const id of moduleIds) {
          const img = byId.get(id);
          if (img) { image = img; break; }
        }
      }
      // Fallback to brand logo
      if (!image && project.brand_id) {
        const { data: b } = await admin
          .from("brands")
          .select("logo_url")
          .eq("id", project.brand_id)
          .maybeSingle();
        if (b?.logo_url) image = b.logo_url;
      }
    }

    const ogImage = image ?? `${APP_ORIGIN}/pwa-512.png`;
    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(targetUrl)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
<meta http-equiv="refresh" content="0; url=${esc(targetUrl)}" />
<link rel="canonical" href="${esc(targetUrl)}" />
<style>
  html,body{margin:0;padding:0;background:#060619;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;height:100%}
  .wrap{display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;text-align:center}
  a{color:#9B5CFF}
</style>
</head>
<body>
  <div class="wrap">
    <div>
      <h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1>
      <p style="opacity:.8;margin:0 0 16px">Redirection vers le dossier…</p>
      <p><a href="${esc(targetUrl)}">Ouvrir le dossier</a></p>
    </div>
  </div>
  <script>window.location.replace(${JSON.stringify(targetUrl)});</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return new Response(`Erreur: ${(e as Error).message}`, { status: 500 });
  }
});
