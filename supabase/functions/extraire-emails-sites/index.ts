import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Récupère l'adresse de contact d'un prospect en visitant son site web.
//
// L'INSEE ne publie aucun email, et OpenStreetMap n'en donne que pour une fiche sur cinq.
// En revanche il fournit le SITE WEB pour plus de la moitié — or un camping publie son
// adresse de contact en évidence : c'est son canal de réservation. On y va donc la lire.
//
// Il s'agit de données publiées volontairement à destination du public, dans un cadre
// strictement professionnel. On privilégie les adresses GÉNÉRIQUES (contact@, info@,
// reservation@) plutôt que nominatives : meilleure délivrabilité, et pas de donnée
// personnelle collectée quand une adresse de service existe.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const UA = 'Mozilla/5.0 (compatible; ArcadeOS/1.0; +https://avranchesautomatic.com)';
const LOT = 60;                  // sites visités par invocation
const PARALLELE = 8;             // requêtes simultanées : rester poli avec de petits hébergeurs
const TIMEOUT_MS = 8_000;
const BUDGET_MS = 110_000;       // les edge functions sont coupées à 150 s
const CHEMINS = ['', '/contact', '/contactez-nous', '/nous-contacter', '/contact.html'];

// Boîtes techniques : elles ne mènent à personne.
const REJETS = /^(no-?reply|ne-?pas-?repondre|postmaster|abuse|webmaster|mailer-daemon|privacy|dpo|rgpd|sentry|wordpress|admin@wix)/i;
const DOMAINES_REJETES = /(sentry|wixpress|example|godaddy|ovh\.net|w3\.org|schema\.org|\.png|\.jpg|\.gif|\.webp|\.svg)/i;
// Une adresse de service vaut mieux qu'une adresse nominative : on la préfère.
const GENERIQUES = /^(contact|info|infos|accueil|reservation|reservations|booking|camping|direction|commercial|bonjour|hello)@/i;

const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function normaliserUrl(brut: string): string | null {
  const v = (brut ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(v.startsWith('http') ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function domaine(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Choisit la meilleure adresse : même domaine que le site d'abord, générique ensuite. */
function meilleurEmail(html: string, site: string): string | null {
  const dom = domaine(site);
  const brut = new Set<string>();

  // Les liens mailto sont les plus fiables : ils sont posés pour être cliqués.
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) brut.add(m[1]);
  for (const m of html.matchAll(RE_EMAIL)) brut.add(m[0]);

  const candidats = [...brut]
    .map((e) => e.trim().toLowerCase().replace(/[.,;:]$/, ''))
    .filter((e) => e.includes('@') && e.length < 80)
    .filter((e) => !REJETS.test(e) && !DOMAINES_REJETES.test(e));

  if (candidats.length === 0) return null;

  const note = (e: string): number => {
    let n = 0;
    if (dom && e.endsWith(`@${dom}`)) n += 100;       // même domaine = c'est bien le sien
    if (GENERIQUES.test(e)) n += 40;                  // adresse de service
    if (/\.(fr|com|eu)$/.test(e)) n += 5;
    return n;
  };
  return candidats.sort((a, b) => note(b) - note(a))[0];
}

async function lirePage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) return null;
    // On ne lit que le début : une adresse de contact figure dans l'en-tête ou le pied de page.
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

async function chercherEmail(site: string): Promise<{ email: string | null; page: string | null }> {
  for (const chemin of CHEMINS) {
    const url = site + chemin;
    const html = await lirePage(url);
    if (!html) continue;
    const email = meilleurEmail(html, site);
    if (email) return { email, page: chemin || '/' };
  }
  return { email: null, page: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const isCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET;
  if (!isCron) {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    const ok = (roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    if (!ok) return json({ error: 'Forbidden' }, 403);
  }

  const debut = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const segment = String(body.segment ?? 'camping').trim();
    const dryRun = body.dry_run === true;
    const lot = Math.min(200, Math.max(1, Number(body.lot ?? LOT)));

    // Cibles : un site web connu, pas encore d'email, et pas déjà tenté.
    const { data: cibles, error } = await admin
      .from('prospects')
      .select('id, entreprise, site_web')
      .eq('source', 'naf').eq('segment', segment)
      .not('site_web', 'is', null)
      .is('email', null)
      .is('email_tente_at', null)
      .limit(lot);
    if (error) throw error;

    const liste = (cibles ?? [])
      .map((p) => ({ ...p, url: normaliserUrl(p.site_web as string) }))
      .filter((p) => p.url);

    let trouves = 0, sansEmail = 0, injoignables = 0;
    const maj: { id: string; email: string | null }[] = [];

    // File d'attente à parallélisme borné : plus rapide qu'en série, sans matraquer
    // les hébergeurs, qui sont souvent modestes pour ce type de sites.
    let curseur = 0;
    const travailleur = async () => {
      while (curseur < liste.length && Date.now() - debut < BUDGET_MS) {
        const p = liste[curseur++];
        const { email } = await chercherEmail(p.url!);
        if (email) { trouves++; maj.push({ id: p.id, email }); }
        else { sansEmail++; maj.push({ id: p.id, email: null }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLELE, liste.length) }, travailleur));
    injoignables = (cibles ?? []).length - liste.length;

    if (!dryRun) {
      const maintenant = new Date().toISOString();
      for (const m of maj) {
        // On marque TOUJOURS la tentative, même infructueuse : sans cela, les sites
        // muets seraient revisités à chaque passage et bloqueraient la progression.
        const patch: Record<string, unknown> = { email_tente_at: maintenant };
        if (m.email) patch.email = m.email;
        const { error: e2 } = await admin.from('prospects').update(patch).eq('id', m.id);
        if (e2) throw e2;
      }
    }

    const { count: restants } = await admin
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'naf').eq('segment', segment)
      .not('site_web', 'is', null).is('email', null).is('email_tente_at', null);

    return json({
      ok: true, dry_run: dryRun, segment,
      sites_visites: liste.length,
      emails_trouves: trouves,
      sites_sans_email: sansEmail,
      urls_invalides: injoignables,
      taux: liste.length ? `${Math.round((100 * trouves) / liste.length)} %` : '—',
      restants_a_traiter: restants ?? null,
      termine: (restants ?? 0) === 0,
      duree_s: Math.round((Date.now() - debut) / 1000),
    });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
