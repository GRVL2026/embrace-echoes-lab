import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) authentifier l'appelant et vérifier qu'il est admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthenticated" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const { data: isAdmin, error: roleErr } = await admin
      .from("user_roles").select("user_id").eq("user_id", callerId).eq("role", "admin").maybeSingle();
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    // 2) valider le body
    const body = await req.json().catch(() => ({}));
    const emailRaw: string = String(body?.email ?? "").trim().toLowerCase();
    if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return json({ error: "invalid_email" }, 400);
    }
    const salle_enabled = Boolean(body?.salle_enabled);
    const dashboard_enabled = Boolean(body?.dashboard_enabled);
    const copilote_enabled = body?.copilote_enabled === undefined ? true : Boolean(body?.copilote_enabled);
    const roleRaw = String(body?.role ?? "commercial").trim().toLowerCase();
    const role = (["admin", "direction", "chef_ventes", "commercial"].includes(roleRaw) ? roleRaw : "commercial");

    // 3) autoriser l'email et pré-configurer les accès
    const { error: allowErr } = await admin.from("allowed_emails")
      .upsert({ email: emailRaw, role }, { onConflict: "email" });
    if (allowErr) return json({ error: `allowed_emails: ${allowErr.message}` }, 500);

    const { error: cfgErr } = await admin.from("invitations_config").upsert({
      email: emailRaw,
      salle_enabled,
      dashboard_enabled,
      copilote_enabled,
      invited_by: callerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (cfgErr) return json({ error: `invitations_config: ${cfgErr.message}` }, 500);

    // 4) envoyer l'invitation Supabase
    const redirectTo = String(body?.redirect_to ?? "") || undefined;
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(emailRaw, {
      redirectTo,
    });
    if (inviteErr) {
      // Si l'utilisateur existe déjà, on renvoie une info claire mais on garde la pré-config
      return json({ error: inviteErr.message, code: (inviteErr as any).code ?? null }, 409);
    }

    return json({
      ok: true,
      user_id: invited?.user?.id ?? null,
      email: emailRaw,
      access: { salle_enabled, dashboard_enabled, copilote_enabled },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
