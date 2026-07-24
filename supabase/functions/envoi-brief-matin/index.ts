import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';

const APP_URL = 'https://embrace-echoes-lab.lovable.app/';
const FROM = 'Arcade OS <brief@avranchesautomatic.com>';
const PROD_TO = ['m.oblin@orange.fr', 'romain.oblin@avranchesautomatic.com'];
const TEST_TO = ['leopaul@avranchesautomatic.com'];

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function isAuthorized(req: Request): Promise<boolean> {
  const cron = req.headers.get('x-cron-secret');
  if (CRON_SECRET && cron === CRON_SECRET) return true;

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims) return false;
  const uid = data.claims.sub as string;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
  return (roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction');
}

// Retourne { y, m, d, dow (0=dim..6=sam), iso } pour "now" en Europe/Paris
function parisToday(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value; return acc;
  }, {});
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { iso, dow: dowMap[parts.weekday] ?? 0 };
}

function fmtEUR(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
}

function fmtDateFR(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------- HTML template ----------------
function shell(title: string, subtitle: string, inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#060619;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e5e7f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060619;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:linear-gradient(180deg,#0d0d24,#080816);border:1px solid rgba(155,92,255,0.25);border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 28px 8px;">
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9B5CFF;font-weight:600;">Arcade OS</div>
          <h1 style="margin:6px 0 4px;font-size:24px;line-height:1.2;color:#ffffff;font-weight:700;">${title}</h1>
          <div style="font-size:14px;color:#9aa0b4;">${subtitle}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 8px;">${inner}</td></tr>
        <tr><td align="center" style="padding:24px 28px 32px;">
          <a href="${APP_URL}" style="display:inline-block;background:#9B5CFF;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:10px;font-size:15px;">Ouvrir dans Arcade OS →</a>
        </td></tr>
        <tr><td style="padding:12px 28px 24px;border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:11px;color:#6b7186;">Envoi automatique — Arcade OS · brief@avranchesautomatic.com</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function kpiCard(label: string, value: string, accent = '#9B5CFF') {
  return `<td width="50%" valign="top" style="padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(155,92,255,0.08);border:1px solid rgba(155,92,255,0.25);border-radius:12px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${accent};font-weight:600;">${label}</div>
        <div style="margin-top:6px;font-size:22px;color:#ffffff;font-weight:700;line-height:1.2;">${value}</div>
      </td></tr>
    </table>
  </td>`;
}

function kpiRow(cards: string[]) {
  const rows: string[] = [];
  for (let i = 0; i < cards.length; i += 2) {
    rows.push(`<tr>${cards[i]}${cards[i+1] ?? '<td width="50%"></td>'}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px -6px 12px;">${rows.join('')}</table>`;
}

function section(title: string, inner: string) {
  return `<div style="margin:18px 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#9aa0b4;font-weight:600;">${title}</div>${inner}`;
}

function listBlock(items: string[]) {
  if (!items.length) return `<div style="color:#6b7186;font-size:13px;">Aucun élément.</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
    ${items.map((li, i) => `<tr><td style="padding:10px 14px;${i>0?'border-top:1px solid rgba(255,255,255,0.05);':''}font-size:13px;color:#d5d8e6;">${li}</td></tr>`).join('')}
  </table>`;
}

// ---------------- Data builders ----------------
async function buildDaily(admin: any, dayISO: string) {
  const [{ data: docs }, { data: hebdo }, briefRow] = await Promise.all([
    admin.rpc('get_briefing_jour_docs', { _jour: dayISO }),
    admin.rpc('get_briefing_activite_hebdo'),
    admin.from('copilot_briefings').select('contenu').eq('date', dayISO).maybeSingle(),
  ]);

  const rows = (docs || []) as any[];
  const devis = rows.filter(r => r.type_doc === 'devis');
  const cdes = rows.filter(r => r.type_doc === 'commande');
  const caDevis = devis.reduce((s, r) => s + Number(r.montant_ht || 0), 0);
  const caCdes = cdes.reduce((s, r) => s + Number(r.montant_ht || 0), 0);

  const b = (briefRow as any)?.data?.contenu || {};
  const alertes: string[] = Array.isArray(b?.alertes_nouvelles) ? b.alertes_nouvelles : [];
  const changements: any[] = Array.isArray(b?.changements) ? b.changements : [];

  const kpis = kpiRow([
    kpiCard('CA commandes (veille)', fmtEUR(caCdes)),
    kpiCard('CA devis (veille)', fmtEUR(caDevis), '#ADFF00'),
    kpiCard('Commandes saisies', String(cdes.length)),
    kpiCard('Devis saisis', String(devis.length), '#ADFF00'),
  ]);

  const topDocs = rows
    .sort((a, b) => Number(b.montant_ht || 0) - Number(a.montant_ht || 0))
    .slice(0, 8)
    .map(r => `<b style="color:#fff;">${r.type_doc === 'devis' ? 'Devis' : 'Commande'}</b> · ${r.n_cde} · ${r.code_client || '—'} · <span style="color:#ADFF00;">${fmtEUR(Number(r.montant_ht||0))}</span>${r.proprietaire ? ` · ${r.proprietaire}` : ''}`);

  let inner = kpis;
  if (b?.resume) {
    inner += `<div style="padding:14px 16px;background:rgba(155,92,255,0.08);border:1px solid rgba(155,92,255,0.25);border-radius:12px;font-size:14px;color:#e5e7f0;line-height:1.5;">${b.resume}</div>`;
  }
  inner += section('Mouvements de la veille', listBlock(topDocs));
  if (changements.length) {
    inner += section('Ce qui a changé', listBlock(changements.map((c: any) => `<b style="color:#fff;">${c.titre}</b> — <span style="color:#9aa0b4;">${c.detail}</span>`)));
  }
  if (alertes.length) {
    inner += section('Alertes', listBlock(alertes.map((a: string) => `<span style="color:#f5b642;">⚠</span> ${a}`)));
  }
  return inner;
}

async function buildWeekly(admin: any) {
  const [{ data: activite }, { data: devisSem }, { data: cdesSem }] = await Promise.all([
    admin.rpc('get_briefing_activite_hebdo'),
    admin.rpc('get_briefing_semaine_docs', { _type_doc: 'devis' }),
    admin.rpc('get_briefing_semaine_docs', { _type_doc: 'commande' }),
  ]);

  const devis = (devisSem || []) as any[];
  const cdes = (cdesSem || []) as any[];
  const caDevis = devis.reduce((s, r) => s + Number(r.montant_ht || 0), 0);
  const caCdes = cdes.reduce((s, r) => s + Number(r.montant_ht || 0), 0);

  const kpis = kpiRow([
    kpiCard('CA commandes (semaine)', fmtEUR(caCdes)),
    kpiCard('CA devis (semaine)', fmtEUR(caDevis), '#ADFF00'),
    kpiCard('Commandes', String(cdes.length)),
    kpiCard('Devis', String(devis.length), '#ADFF00'),
  ]);

  // Aggrégat par jour
  const perDay: Record<string, { devis: number; cde: number }> = {};
  for (const r of (activite || []) as any[]) {
    const k = r.jour;
    perDay[k] = perDay[k] || { devis: 0, cde: 0 };
    if (r.type_doc === 'devis') perDay[k].devis += Number(r.n_docs || 0);
    else perDay[k].cde += Number(r.n_docs || 0);
  }
  const jours = Object.keys(perDay).sort();
  const lignes = jours.map(k => {
    const d = new Date(k + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    return `<b style="color:#fff;">${d}</b> — <span style="color:#ADFF00;">${perDay[k].devis} devis</span> · ${perDay[k].cde} commandes`;
  });

  const topCdes = cdes
    .sort((a, b) => Number(b.montant_ht || 0) - Number(a.montant_ht || 0))
    .slice(0, 6)
    .map(r => `<b style="color:#fff;">${r.n_cde}</b> · ${r.code_client || '—'} · <span style="color:#ADFF00;">${fmtEUR(Number(r.montant_ht||0))}</span>${r.proprietaire ? ` · ${r.proprietaire}` : ''}`);

  let inner = kpis;
  inner += section('Activité par jour', listBlock(lignes));
  inner += section('Top commandes de la semaine', listBlock(topCdes));
  return inner;
}

// ---------------- Resend ----------------
async function sendResend(to: string[], subject: string, html: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Resend ${r.status}: ${body.slice(0, 300)}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!(await isAuthorized(req))) return j(401, { error: 'Unauthorized' });
    if (!RESEND_API_KEY) return j(500, { error: 'RESEND_API_KEY manquant' });

    let testMode = false;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body?.test === true) testMode = true;
      } catch { /* no body */ }
    }

    const { iso, dow } = parisToday();

    if (dow === 0) return j(200, { skipped: 'dimanche' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const to = testMode ? TEST_TO : PROD_TO;

    let type: 'hebdo' | 'quotidien';
    let subject: string;
    let title: string;
    let subtitle: string;
    let inner: string;

    if (dow === 1) {
      type = 'hebdo';
      subject = 'Récap de la semaine — Arcade OS';
      title = 'Récap de la semaine';
      subtitle = 'Semaine écoulée · lundi ' + fmtDateFR(iso);
      inner = await buildWeekly(admin);
    } else {
      type = 'quotidien';
      // veille
      const y = parisToday(-1).iso;
      subject = `Brief Arcade OS — ${fmtDateFR(iso)}`;
      title = `Brief du ${fmtDateFR(iso)}`;
      subtitle = `Récap de la veille — ${fmtDateFR(y)}`;
      inner = await buildDaily(admin, y);
    }

    const html = shell(title, subtitle, inner);
    await sendResend(to, subject, html);

    return j(200, { sent: to, jour: iso, type, test: testMode });
  } catch (e) {
    return j(500, { error: (e as Error).message });
  }
});
