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

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtEUR(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
}

function fmtDateFR(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------- Email-safe HTML template ----------------
// Contraintes : tables uniquement, styles 100% inline, bgcolor en dur,
// pas de gradient / flex / grid / <style>, largeur max 600px.
function shell(title: string, subtitle: string, inner: string) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0d24;color:#e5e7f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" bgcolor="#0d0d24">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d0d24" style="background-color:#0d0d24;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#12122a" style="width:100%;max-width:600px;background-color:#12122a;border:1px solid #2a2350;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c9a8ff;font-weight:600;">Arcade OS</div>
              <h1 style="margin:6px 0 4px;font-size:22px;line-height:1.25;color:#ffffff;font-weight:700;">${title}</h1>
              <div style="font-size:14px;color:#b8bcd0;">${subtitle}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">${inner}</td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#9B5CFF" style="background-color:#9B5CFF;border-radius:8px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Ouvrir dans Arcade OS</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 24px;border-top:1px solid #2a2350;">
              <div style="font-size:11px;color:#8f95ad;">Envoi automatique — Arcade OS · brief@avranchesautomatic.com</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function kpiCard(label: string, value: string, accent = '#c9a8ff') {
  return `<td width="50%" valign="top" style="padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a1740" style="background-color:#1a1740;border:1px solid #2a2350;border-radius:10px;">
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">${rows.join('')}</table>`;
}

function section(title: string, inner: string) {
  return `<div style="margin:18px 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#b8bcd0;font-weight:600;">${title}</div>${inner}`;
}

function listBlock(items: string[]) {
  if (!items.length) return `<div style="color:#8f95ad;font-size:13px;">Aucun élément.</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#161435" style="background-color:#161435;border:1px solid #2a2350;border-radius:10px;">
    ${items.map((li, i) => `<tr><td style="padding:10px 14px;${i>0?'border-top:1px solid #2a2350;':''}font-size:13px;color:#dcdfef;line-height:1.5;">${li}</td></tr>`).join('')}
  </table>`;
}

// ---------------- Data builders ----------------
async function buildDaily(admin: any, dayISO: string) {
  const [{ data: docs }, briefRow] = await Promise.all([
    admin.rpc('get_briefing_jour_docs', { _jour: dayISO }),
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
    kpiCard('CA devis (veille)', fmtEUR(caDevis), '#c8ff6a'),
    kpiCard('Commandes saisies', String(cdes.length)),
    kpiCard('Devis saisis', String(devis.length), '#c8ff6a'),
  ]);

  const topDocs = rows
    .sort((a, b) => Number(b.montant_ht || 0) - Number(a.montant_ht || 0))
    .slice(0, 8)
    .map(r => `<b style="color:#ffffff;">${r.type_doc === 'devis' ? 'Devis' : 'Commande'}</b> · ${r.n_cde} · ${r.code_client || '—'} · <span style="color:#c8ff6a;">${fmtEUR(Number(r.montant_ht||0))}</span>${r.proprietaire ? ` · ${r.proprietaire}` : ''}`);

  let inner = kpis;
  if (b?.resume) {
    inner += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a1740" style="background-color:#1a1740;border:1px solid #2a2350;border-radius:10px;"><tr><td style="padding:14px 16px;font-size:14px;color:#e5e7f0;line-height:1.5;">${b.resume}</td></tr></table>`;
  }
  inner += section('Mouvements de la veille', listBlock(topDocs));
  if (changements.length) {
    inner += section('Ce qui a changé', listBlock(changements.map((c: any) => `<b style="color:#ffffff;">${c.titre}</b> — <span style="color:#b8bcd0;">${c.detail}</span>`)));
  }
  if (alertes.length) {
    inner += section('Alertes', listBlock(alertes.map((a: string) => `<span style="color:#f5b642;">&#9888;</span> ${a}`)));
  }
  return inner;
}

// Récap hebdo = SEMAINE PRÉCÉDENTE COMPLÈTE (lundi -> dimanche)
// Calcul en direct sur gaia_commandes pour ne pas dépendre des RPC "semaine en cours".
async function buildWeekly(admin: any, mondayISO: string) {
  // mondayISO = lundi d'AUJOURD'HUI ; on veut la semaine [monday-7, monday-1]
  const start = addDaysISO(mondayISO, -7); // lundi précédent
  const endInclusive = addDaysISO(mondayISO, -1); // dimanche précédent
  const endExclusive = mondayISO; // < lundi actuel

  const { data: lignes, error } = await admin
    .from('gaia_commandes')
    .select('n_cde,type_cde,code_client,invoice_date,montant_ht,classe_article,proprietaire_id')
    .in('type_cde', ['QT', 'SO'])
    .gte('invoice_date', start)
    .lt('invoice_date', endExclusive);

  if (error) throw error;

  // Agrégation par document (n_cde)
  const byDoc = new Map<string, { type: 'devis'|'commande'; n_cde: string; code_client: string|null; jour: string; montant: number; proprietaire_id: number|null }>();
  for (const l of (lignes || []) as any[]) {
    const type = l.type_cde === 'QT' ? 'devis' : 'commande';
    const key = `${type}::${l.n_cde}`;
    const cur = byDoc.get(key);
    const m = Number(l.montant_ht || 0);
    if (!cur) {
      byDoc.set(key, {
        type, n_cde: l.n_cde,
        code_client: l.code_client || null,
        jour: l.invoice_date,
        montant: m,
        proprietaire_id: l.proprietaire_id ?? null,
      });
    } else {
      cur.montant += m;
      if (l.invoice_date < cur.jour) cur.jour = l.invoice_date;
    }
  }

  const docs = Array.from(byDoc.values());
  const devis = docs.filter(d => d.type === 'devis');
  const cdes = docs.filter(d => d.type === 'commande');
  const caDevis = devis.reduce((s, d) => s + d.montant, 0);
  const caCdes = cdes.reduce((s, d) => s + d.montant, 0);

  // Résolution propriétaires
  const ownerIds = Array.from(new Set(docs.map(d => d.proprietaire_id).filter((x): x is number => x != null)));
  const owners = new Map<number, string>();
  if (ownerIds.length) {
    const { data: eq } = await admin.from('gaia_equipe').select('contact_id,nom').in('contact_id', ownerIds);
    for (const e of (eq || []) as any[]) owners.set(e.contact_id, e.nom);
  }

  const kpis = kpiRow([
    kpiCard('CA commandes (semaine)', fmtEUR(caCdes)),
    kpiCard('CA devis (semaine)', fmtEUR(caDevis), '#c8ff6a'),
    kpiCard('Commandes', String(cdes.length)),
    kpiCard('Devis', String(devis.length), '#c8ff6a'),
  ]);

  // Activité par jour
  const perDay = new Map<string, { devis: number; cde: number }>();
  for (const d of docs) {
    const cur = perDay.get(d.jour) || { devis: 0, cde: 0 };
    if (d.type === 'devis') cur.devis += 1; else cur.cde += 1;
    perDay.set(d.jour, cur);
  }
  const jours: string[] = [];
  for (let i = 0; i < 7; i++) jours.push(addDaysISO(start, i));
  const lignesJour = jours.map(k => {
    const v = perDay.get(k) || { devis: 0, cde: 0 };
    const d = new Date(k + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    return `<b style="color:#ffffff;">${d}</b> — <span style="color:#c8ff6a;">${v.devis} devis</span> · ${v.cde} commandes`;
  });

  const topCdes = cdes
    .sort((a, b) => b.montant - a.montant)
    .slice(0, 6)
    .map(d => {
      const owner = d.proprietaire_id != null ? owners.get(d.proprietaire_id) : null;
      return `<b style="color:#ffffff;">${d.n_cde}</b> · ${d.code_client || '—'} · <span style="color:#c8ff6a;">${fmtEUR(d.montant)}</span>${owner ? ` · ${owner}` : ''}`;
    });

  const periode = `<div style="font-size:12px;color:#b8bcd0;margin:0 0 8px;">Période&nbsp;: ${fmtDateFR(start)} → ${fmtDateFR(endInclusive)}</div>`;

  let inner = periode + kpis;
  inner += section('Activité par jour', listBlock(lignesJour));
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
    let forcedType: 'hebdo' | 'quotidien' | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body?.test === true) testMode = true;
        if (body?.type === 'hebdo' || body?.type === 'quotidien') forcedType = body.type;
      } catch { /* no body */ }
    }

    const { iso, dow } = parisToday();

    if (forcedType === null && dow === 0) return j(200, { skipped: 'dimanche' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const to = testMode ? TEST_TO : PROD_TO;

    let type: 'hebdo' | 'quotidien';
    let subject: string;
    let title: string;
    let subtitle: string;
    let inner: string;

    const useWeekly = forcedType ? forcedType === 'hebdo' : dow === 1;
    if (useWeekly) {
      type = 'hebdo';
      const start = addDaysISO(iso, -7);
      const endIncl = addDaysISO(iso, -1);
      subject = `Récap de la semaine (${fmtDateFR(start)} → ${fmtDateFR(endIncl)}) — Arcade OS`;
      title = 'Récap de la semaine';
      subtitle = `Semaine écoulée · ${fmtDateFR(start)} → ${fmtDateFR(endIncl)}`;
      inner = await buildWeekly(admin, iso);
    } else {
      type = 'quotidien';
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
