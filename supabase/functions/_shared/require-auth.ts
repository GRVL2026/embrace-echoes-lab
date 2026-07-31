import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * Authentification obligatoire (verify_jwt = false : on valide nous-mêmes).
 * Retourne une Response 401 si le JWT est absent ou invalide, sinon null.
 */
export async function requireAuth(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const jwt = authHeader.slice(7);
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data, error } = await authClient.auth.getUser(jwt);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}
