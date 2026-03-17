import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const POLYHAVEN_API = "https://api.polyhaven.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // ── Mode 1: Proxy a raw texture file URL ──
    const fileUrl = url.searchParams.get("file_url");
    if (fileUrl) {
      // Only allow polyhaven domains
      const parsed = new URL(fileUrl);
      if (!parsed.hostname.endsWith("polyhaven.org") && !parsed.hostname.endsWith("polyhaven.com")) {
        return new Response(JSON.stringify({ error: "Only Poly Haven URLs allowed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const fileRes = await fetch(fileUrl, {
        headers: { "User-Agent": "HypernovaPlanner/1.0" },
      });

      if (!fileRes.ok) {
        return new Response(JSON.stringify({ error: `File fetch error: ${fileRes.status}` }), {
          status: fileRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
      const body = await fileRes.arrayBuffer();

      return new Response(body, {
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // ── Mode 2: Proxy a JSON API call ──
    const endpoint = url.searchParams.get("endpoint");
    if (!endpoint) {
      return new Response(JSON.stringify({ error: "Missing endpoint or file_url param" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetUrl = new URL(`${POLYHAVEN_API}${endpoint}`);
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== "endpoint") {
        targetUrl.searchParams.set(key, value);
      }
    }

    const response = await fetch(targetUrl.toString(), {
      headers: { "User-Agent": "HypernovaPlanner/1.0" },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Poly Haven API error: ${response.status}` }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
