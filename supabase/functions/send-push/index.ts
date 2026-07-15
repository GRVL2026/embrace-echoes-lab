import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import webpush from "npm:web-push@3.6.7";

interface Body {
  user_id?: string;
  title?: string;
  body?: string;
  url?: string;
  icon?: string;
  tag?: string;
  test?: boolean;
}

function truncate(s: string, n = 60): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Public endpoint: expose only the VAPID public key so the browser can subscribe.
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const internal = req.headers.get("x-internal-secret");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization") ?? "";

    const payload = (await req.json().catch(() => ({}))) as Body;
    let title = typeof payload.title === "string" ? payload.title : "Notification";
    let body = typeof payload.body === "string" ? payload.body : "";
    const url = typeof payload.url === "string" ? payload.url : "/";

    let userId = "";
    const isInternal = !!(cronSecret && internal === cronSecret);

    if (isInternal) {
      userId = typeof payload.user_id === "string" ? payload.user_id : "";
    } else if (authHeader.startsWith("Bearer ")) {
      // Authenticated caller: user sends a notification to themselves.
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const token = authHeader.replace("Bearer ", "");
      const { data, error } = await authClient.auth.getClaims(token);
      if (error || !data?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = data.claims.sub as string;
      if (payload.test) {
        title = "🔔 Test de notification";
        body = "Si tu vois ceci, les notifications fonctionnent ✓";
      }
    } else {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: subs, error } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notif = JSON.stringify({
      title,
      body,
      url,
      icon: payload.icon ?? "/pwa-192.png",
      tag: payload.tag,
    });

    let sent = 0;
    let removed = 0;
    const results: Array<{ endpoint: string; status: number | null; error?: string }> = [];

    for (const s of subs ?? []) {
      const endpointShort = truncate(s.endpoint, 60);
      try {
        const res = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notif,
        );
        sent++;
        results.push({ endpoint: endpointShort, status: (res as { statusCode?: number }).statusCode ?? 201 });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? null;
        const msg = (e as Error).message ?? "unknown";
        results.push({ endpoint: endpointShort, status, error: msg });
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          removed++;
        } else {
          console.error("push send failed", status, msg);
        }
      }
    }

    return new Response(
      JSON.stringify({ sent, removed, total: (subs ?? []).length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message ?? "Erreur serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
