import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const FROM = 'Avranches Automatic <contact@avranchesautomatic.com>';

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function toHtml(corps: string): string {
  const escaped = corps
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #111;">${escaped
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px 0;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('')}</div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) return jsonErr(500, "Envoi non configuré (RESEND_API_KEY manquant)");

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return jsonErr(401, 'Unauthorized');
    const jwt = authHeader.slice(7);
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonErr(401, 'Unauthorized');

    const { data: canRea, error: canErr } = await sb.rpc('can_reactivation', { _uid: userData.user.id });
    if (canErr || !canRea) return jsonErr(403, 'Forbidden');

    const body = await req.json().catch(() => ({}));
    const code = String(body.code_client || '').trim();
    const objet = String(body.objet || '').trim();
    const corps = String(body.corps || '').trim();
    const prochaine = body.prochaine_relance ? String(body.prochaine_relance) : null;
    if (!code || !objet || !corps) return jsonErr(400, 'code_client, objet et corps requis');

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: client, error: cErr } = await admin
      .from('gaia_clients')
      .select('customer_id, name, email')
      .eq('customer_id', code)
      .maybeSingle();
    if (cErr || !client) return jsonErr(404, 'Client introuvable');
    if (!isEmail(client.email)) return jsonErr(400, "Email client non renseigné");

    // Récupère le nom d'expéditeur (reply-to = commercial)
    const { data: prof } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', userData.user.id)
      .maybeSingle();
    const replyTo = prof?.email || undefined;

    // Envoi Resend
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [client.email],
        subject: objet,
        html: toHtml(corps),
        text: corps,
        reply_to: replyTo,
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      console.error('[envoyer-relance-client] Resend error', resendResp.status, errText);
      return new Response(
        JSON.stringify({ error: 'Envoi échoué', status: resendResp.status, details: errText }),
        { status: resendResp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const resendData = await resendResp.json().catch(() => ({}));

    // Log action type=mail (déclenche aussi le trigger d'attribution owner)
    const contenu = `Objet : ${objet}\n\n${corps}`;
    const { error: aErr } = await admin.from('client_actions').insert({
      code_client: code,
      auteur_id: userData.user.id,
      type: 'mail',
      contenu,
      resultat: `envoyé à ${client.email}`,
      prochaine_relance: prochaine,
    });
    if (aErr) {
      console.error('[envoyer-relance-client] log action error', aErr);
    }

    return new Response(JSON.stringify({ ok: true, id: resendData?.id ?? null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[envoyer-relance-client]', err);
    return jsonErr(500, err instanceof Error ? err.message : 'Erreur interne');
  }
});
