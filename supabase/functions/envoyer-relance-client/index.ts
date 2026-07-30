import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Permission restreinte (défaut OFF, accordée compte par compte dans l'administration).
const REQUIRED_PERMISSION = 'relance.envoyer_mail';
const REQUIRED_DOMAIN = '@avranchesautomatic.com';

function jsonErr(status: number, error: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error, ...(extra || {}) }), {
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

    const senderEmailRaw = (userData.user.email || '').trim();
    const senderEmail = senderEmailRaw.toLowerCase();
    if (!senderEmail) return jsonErr(401, 'Utilisateur sans email');

    // Gating : uniquement les expéditeurs explicitement autorisés (Léopaul pour l'instant).
    if (!ALLOWED_SENDERS.has(senderEmail)) {
      return jsonErr(403, "Envoi non autorisé pour votre compte (fonctionnalité en pilote).");
    }

    // Garde-fou expéditeur : le domaine doit être signé par Resend.
    if (!senderEmail.endsWith(REQUIRED_DOMAIN)) {
      return jsonErr(
        403,
        `Impossible d'envoyer depuis ${senderEmailRaw} : seule une adresse ${REQUIRED_DOMAIN} peut être signée.`,
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code_client || '').trim();
    const prospectId = String(body.prospect_id || '').trim();
    const objet = String(body.objet || '').trim();
    const corps = String(body.corps || '').trim();
    const prochaine = body.prochaine_relance ? String(body.prochaine_relance) : null;
    if ((!code && !prospectId) || !objet || !corps) {
      return jsonErr(400, 'code_client (ou prospect_id), objet et corps sont requis');
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Nom complet expéditeur (profiles.full_name > user.raw_user_meta_data > email local part).
    const { data: senderProf } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', userData.user.id)
      .maybeSingle();
    const metaName =
      (userData.user.user_metadata as any)?.full_name ||
      (userData.user.user_metadata as any)?.name ||
      null;
    const senderName =
      (senderProf?.full_name && String(senderProf.full_name).trim()) ||
      (metaName && String(metaName).trim()) ||
      senderEmailRaw.split('@')[0];

    // Résout le destinataire (client OU prospect).
    let recipientEmail = '';
    let recipientLabel = '';
    if (code) {
      const { data: client, error: cErr } = await admin
        .from('gaia_clients')
        .select('customer_id, name, email')
        .eq('customer_id', code)
        .maybeSingle();
      if (cErr || !client) return jsonErr(404, 'Client introuvable');
      recipientEmail = String(client.email || '').trim();
      recipientLabel = client.name || client.customer_id;
    } else {
      const { data: prospect, error: pErr } = await admin
        .from('prospects')
        .select('id, entreprise, email')
        .eq('id', prospectId)
        .maybeSingle();
      if (pErr || !prospect) return jsonErr(404, 'Prospect introuvable');
      recipientEmail = String(prospect.email || '').trim();
      recipientLabel = prospect.entreprise || prospect.id;
    }
    if (!isEmail(recipientEmail)) {
      return jsonErr(400, `Email du destinataire non renseigné (${recipientLabel}).`);
    }

    // Envoi Resend depuis l'adresse du commercial connecté.
    const fromHeader = `${senderName} <${senderEmailRaw}>`;
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [recipientEmail],
        subject: objet,
        html: toHtml(corps),
        text: corps,
        reply_to: senderEmailRaw,
        bcc: [senderEmailRaw],
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      console.error('[envoyer-relance-client] Resend error', resendResp.status, errText);
      let details = errText;
      try {
        const parsed = JSON.parse(errText);
        details = parsed?.message || parsed?.error || errText;
      } catch { /* keep raw text */ }
      return jsonErr(resendResp.status, `Envoi Resend refusé : ${details}`, {
        resend_status: resendResp.status,
        resend_body: errText,
      });
    }
    const resendData = await resendResp.json().catch(() => ({}));

    // Journalise l'action côté client (déclenche aussi le trigger d'attribution owner).
    if (code) {
      const contenu = `Objet : ${objet}\n\nDe : ${fromHeader}\n\n${corps}`;
      const { error: aErr } = await admin.from('client_actions').insert({
        code_client: code,
        auteur_id: userData.user.id,
        type: 'mail',
        contenu,
        resultat: `envoyé à ${recipientEmail}`,
        prochaine_relance: prochaine,
      });
      if (aErr) console.error('[envoyer-relance-client] log action error', aErr);
    } else if (prospectId) {
      // Prospect : attribue au commercial + note simple, statut « contacte » si vierge.
      const { data: cur } = await admin
        .from('prospects')
        .select('owner_id, statut, notes')
        .eq('id', prospectId)
        .maybeSingle();
      const nowIso = new Date().toISOString();
      const noteLine = `[${nowIso.slice(0, 10)}] Mail envoyé (${senderEmailRaw}) — objet: ${objet}`;
      const notes = cur?.notes ? `${cur.notes}\n${noteLine}` : noteLine;
      const nextStatut = !cur?.statut || cur.statut === 'nouveau' ? 'contacte' : cur.statut;
      const patch: Record<string, unknown> = {
        notes,
        statut: nextStatut,
        updated_at: nowIso,
      };
      if (!cur?.owner_id) patch.owner_id = userData.user.id;
      const { error: pErr } = await admin.from('prospects').update(patch).eq('id', prospectId);
      if (pErr) console.error('[envoyer-relance-client] update prospect error', pErr);
    }

    return new Response(
      JSON.stringify({ ok: true, id: resendData?.id ?? null, from: fromHeader, to: recipientEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[envoyer-relance-client]', err);
    return jsonErr(500, err instanceof Error ? err.message : 'Erreur interne');
  }
});
