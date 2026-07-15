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
    if (!cronSecret || internal !== cronSecret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (await req.json().catch(() => ({}))) as Body;
    const userId = typeof payload.user_id === "string" ? payload.user_id : "";
    const title = typeof payload.title === "string" ? payload.title : "Notification";
    const body = typeof payload.body === "string" ? payload.body : "";
    const url = typeof payload.url === "string" ? payload.url : "/";
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
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          notif,
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          removed++;
        } else {
          console.error("push send failed", status, (e as Error).message);
        }
      }
    }

    return new Response(JSON.stringify({ sent, removed, total: (subs ?? []).length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message ?? "Erreur serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
