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
    const endpoint = url.searchParams.get("endpoint");
    if (!endpoint) {
      return new Response(JSON.stringify({ error: "Missing endpoint param" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build target URL preserving extra query params
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
