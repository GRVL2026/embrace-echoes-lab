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
// Soixante sites à huit en parallèle, sur cinq chemins chacun, faisaient jusqu'à trois
// cents requêtes et autant de pages en mémoire dans une même invocation : Supabase
// coupait le worker par un HTTP 546. Le travail était pourtant écrit avant la coupure —
// seule la réponse se perdait, ce qui rendait la panne difficile à lire depuis l'appelant.
// Vingt-cinq sites à cinq en parallèle tiennent confortablement.
const LOT = 25;                  // sites visités par invocation
const PARALLELE = 5;             // requêtes simultanées : rester poli avec de petits hébergeurs
const TIMEOUT_MS = 8_000;
const MAX_OCTETS = 400_000;      // au-delà, on cesse de lire : le contact est en haut ou en bas de page
const BUDGET_MS = 110_000;       // les edge functions sont coupées à 150 s
const CHEMINS = ['', '/contact', '/contactez-nous', '/nous-contacter', '/contact.html'];

// Boîtes techniques : elles ne mènent à personne.
const REJETS = /^(no-?reply|ne-?pas-?repondre|postmaster|abuse|webmaster|mailer-daemon|privacy|dpo|rgpd|sentry|wordpress|admin@wix)/i;
const DOMAINES_REJETES = /(sentry|wixpress|example|godaddy|ovh\.net|w3\.org|schema\.org|\.png|\.jpg|\.gif|\.webp|\.svg)/i;
// Une adresse de service vaut mieux qu'une adresse nominative : on la préfère.
const GENERIQUES = /^(contact|info|infos|accueil|reservation|reservations|booking|camping|direction|commercial|bonjour|hello)@/i;

// Les quantificateurs sont BORNÉS, et ce n'est pas une coquetterie.
//
// La version d'origine s'écrivait `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` :
// un `+` non borné suivi d'un point littéral, alors que le point appartient déjà à la
// classe. Sur une longue suite sans arobase — du JavaScript minifié, par exemple — le
// moteur reprend l'essai à chaque position et le coût grimpe au carré de la longueur.
// Quatre cent mille caractères suffisaient à brûler le CPU du worker, que Supabase
// coupait par un WORKER_RESOURCE_LIMIT en quatre secondes.
//
// Les bornes correspondent à la norme : 64 caractères avant l'arobase, 255 après,
// 24 pour l'extension. Aucune adresse réelle n'est perdue.
const RE_EMAIL = /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63}){0,4}\.[a-zA-Z]{2,24}/g;

/** Le contact d'un exploitant est dans son texte, jamais dans son code. Retirer les
 *  scripts et les styles enlève l'essentiel du volume — et précisément la matière
 *  minifiée qui met les expressions régulières en difficulté. */
function texteUtile(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

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

// Le téléphone est sur la même page que l'email : le prendre au passage ne coûte rien.
// Les liens tel: priment — ils sont posés pour être composés, donc fiables.
const RE_TEL = /(?:\+33|0)\s?[1-9](?:[\s.\-]?\d{2}){4}/g;

/** Ramène un numéro français à la forme lisible « 02 51 58 83 86 ». */
function normaliserTel(brut: string): string | null {
  let n = (brut ?? '').replace(/[^\d+]/g, '');
  if (n.startsWith('+33')) n = '0' + n.slice(3);
  else if (n.startsWith('0033')) n = '0' + n.slice(4);
  if (!/^0[1-9]\d{8}$/.test(n)) return null;
  // 08 = numéros surtaxés, 09 = box internet : sans intérêt pour joindre un gérant.
  if (n.startsWith('08')) return null;
  return n.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

function meilleurTel(html: string): string | null {
  const candidats: string[] = [];
  for (const m of html.matchAll(/href=["']tel:([^"']+)/gi)) candidats.push(m[1]);
  for (const m of html.matchAll(RE_TEL)) candidats.push(m[0]);
  for (const c of candidats) {
    const t = normaliserTel(c);
    if (t) return t;
  }
  return null;
}

async function lirePage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) { await res.body?.cancel(); return null; }

    // ON COUPE AU FLUX, PAS APRÈS COUP.
    //
    // La version précédente faisait `(await res.text()).slice(0, 400_000)` : le
    // `.slice` n'intervenait qu'une fois la page ENTIÈREMENT chargée en mémoire. Un
    // seul site copieux suffisait alors à faire dépasser le worker, que Supabase
    // tuait par un WORKER_RESOURCE_LIMIT — en quatre secondes, avant même d'avoir
    // visité les autres. Et comme l'ordre de la file est déterministe, on retombait
    // sur le même site à chaque appel : la source entière restait bloquée par une
    // seule fiche, y compris avec un lot de trois.
    //
    // On s'arrête donc dès qu'on a de quoi travailler. Une adresse de contact figure
    // dans l'en-tête ou le pied de page ; quatre cent mille caractères en couvrent
    // très largement l'un et l'autre.
    const lecteur = res.body?.getReader();
    if (!lecteur) return null;
    const morceaux: Uint8Array[] = [];
    let lus = 0;
    while (lus < MAX_OCTETS) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (value) { morceaux.push(value); lus += value.length; }
    }
    // Fermer la connexion sans attendre la fin du téléchargement : sur une page
    // interminable, l'oublier laisserait le flux ouvert jusqu'au bout.
    await lecteur.cancel().catch(() => { /* déjà close */ });

    const tampon = new Uint8Array(lus);
    let pos = 0;
    for (const m of morceaux) { tampon.set(m, pos); pos += m.length; }
    return new TextDecoder('utf-8', { fatal: false }).decode(tampon);
  } catch {
    return null;
  }
}

async function chercherContacts(site: string): Promise<{ email: string | null; tel: string | null }> {
  let tel: string | null = null;
  for (const chemin of CHEMINS) {
    const brut = await lirePage(site + chemin);
    if (!brut) continue;
    // On travaille sur le texte, débarrassé des scripts et des styles : c'est là que
    // se trouve le contact, et c'est ce qui rend la lecture prévisible en temps.
    const html = texteUtile(brut);
    tel ??= meilleurTel(html);
    const email = meilleurEmail(html, site);
    // On continue à parcourir les pages tant qu'il manque l'un des deux.
    if (email) return { email, tel: tel ?? meilleurTel(html) };
  }
  return { email: null, tel };
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

    // Née pour les campings INSEE, la fonction sert désormais aussi aux lieux relevés sur
    // des sources publiques, qui portent une autre source et plusieurs segments. Les
    // valeurs par défaut préservent le comportement d'origine.
    const source = String(body.source ?? 'naf').trim();
    const segments: string[] = Array.isArray(body.segments) && body.segments.length
      ? body.segments.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [segment];

    // Cibles : un site web connu, pas encore d'email, et pas déjà tenté.
    const { data: cibles, error } = await admin
      .from('prospects')
      .select('id, entreprise, site_web')
      .eq('source', source).in('segment', segments)
      .not('site_web', 'is', null)
      .is('email', null)
      .is('email_tente_at', null)
      .limit(lot);
    if (error) throw error;

    const liste = (cibles ?? [])
      .map((p) => ({ ...p, url: normaliserUrl(p.site_web as string) }))
      .filter((p) => p.url);

    let trouves = 0, sansEmail = 0, injoignables = 0, telsTrouves = 0;
    const maj: { id: string; email: string | null; tel: string | null }[] = [];

    // File d'attente à parallélisme borné : plus rapide qu'en série, sans matraquer
    // les hébergeurs, qui sont souvent modestes pour ce type de sites.
    let curseur = 0;
    const travailleur = async () => {
      while (curseur < liste.length && Date.now() - debut < BUDGET_MS) {
        const p = liste[curseur++];
        const { email, tel } = await chercherContacts(p.url!);
        if (email) trouves++; else sansEmail++;
        if (tel) telsTrouves++;
        maj.push({ id: p.id, email, tel });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLELE, liste.length) }, travailleur));
    injoignables = (cibles ?? []).length - liste.length;

    if (!dryRun) {
      const maintenant = new Date().toISOString();
      for (const m of maj) {
        // On marque TOUJOURS la tentative, même infructueuse : sans cela, les sites
        // muets seraient revisités à chaque passage et bloqueraient la progression.
        // DEUX ÉCRITURES SÉPARÉES, ET C'EST ESSENTIEL.
        //
        // Le garde-fou « ne pas écraser un téléphone existant » était posé sur la
        // requête entière : dès que la fiche avait déjà un numéro, la condition ne
        // filtrait plus rien du tout — elle annulait l'écriture complète, e-mail et
        // horodatage compris. Ces fiches revenaient donc à chaque appel, indéfiniment,
        // et leur site était revisité en boucle. Mille cinq cents visites inutiles
        // avant que le compteur « restants », figé, ne le trahisse.
        const patch: Record<string, unknown> = { email_tente_at: maintenant };
        if (m.email) patch.email = m.email;
        const { error: e2 } = await admin.from('prospects').update(patch).eq('id', m.id);
        if (e2) throw e2;

        // Le téléphone d'OpenStreetMap, quand il existe, a été renseigné par un humain :
        // on ne l'écrase pas avec celui déniché sur le site. Cette prudence-là ne
        // concerne QUE le téléphone, d'où sa propre requête.
        if (m.tel) {
          const { error: e3 } = await admin.from('prospects')
            .update({ telephone: m.tel }).eq('id', m.id).is('telephone', null);
          if (e3) throw e3;
        }
      }
    }

    const { count: restants } = await admin
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('source', source).in('segment', segments)
      .not('site_web', 'is', null).is('email', null).is('email_tente_at', null);

    return json({
      ok: true, dry_run: dryRun, segment,
      sites_visites: liste.length,
      emails_trouves: trouves,
      telephones_trouves: telsTrouves,
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
