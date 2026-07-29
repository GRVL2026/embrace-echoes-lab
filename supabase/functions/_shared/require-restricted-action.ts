import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Require the caller to be authenticated AND to have an explicit
 * `user_menu_access` row with allowed=true for the given restricted key.
 *
 * Contrairement au menu classique (défaut ON), ces permissions sont
 * strictement OFF sauf accord explicite (accordé depuis Réglages > Utilisateurs).
 */
export async function requireRestrictedAction(
  req: Request,
  key: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const header = req.headers.get('Authorization') || '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!jwt) return { ok: false, response: jsonErr(401, 'Unauthorized') };

  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error } = await sb.auth.getUser(jwt);
  if (error || !userData?.user) {
    return { ok: false, response: jsonErr(401, 'Unauthorized') };
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: row } = await admin
    .from('user_menu_access')
    .select('allowed')
    .eq('user_id', userData.user.id)
    .eq('section_key', key)
    .maybeSingle();

  if (!row || row.allowed !== true) {
    return {
      ok: false,
      response: jsonErr(403, `Action réservée (permission manquante : ${key})`),
    };
  }

  return { ok: true, userId: userData.user.id };
}
