import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type Role = 'admin' | 'direction' | 'commercial';

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Require the caller to be authenticated and have at least one of the given roles.
 * Accepts the JWT either from the Authorization header (Bearer) or, as a fallback
 * for image/attachment tags that can't set headers, from the `token` query param.
 */
export async function requireRole(
  req: Request,
  allowed: Role[],
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const header = req.headers.get('Authorization') || '';
  let jwt = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!jwt) {
    try {
      const url = new URL(req.url);
      jwt = url.searchParams.get('token') || '';
    } catch { /* ignore */ }
  }
  if (!jwt) return { ok: false, response: jsonErr(401, 'Unauthorized') };

  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, response: jsonErr(401, 'Unauthorized') };

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id);
  const has = (roles || []).some((r: any) => allowed.includes(r.role));
  if (!has) return { ok: false, response: jsonErr(403, 'Forbidden') };

  return { ok: true, userId: data.user.id };
}
