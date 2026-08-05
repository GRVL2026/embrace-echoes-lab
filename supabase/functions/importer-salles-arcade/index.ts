import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { departementDepuisCP, regionDepuisCP } from '../_shared/territoire.ts';

// Annuaire des salles d'arcade — 819 lieux qui possèdent DÉJÀ des bornes, avec
// l'inventaire nominatif de leurs machines.
//
// Ce ne sont pas des suspects mais des acheteurs avérés : la question n'est plus de
// savoir si le sujet les intéresse, mais chez qui ils achètent. L'inventaire répond à
// la seconde moitié — une salle équipée de machines de notre catalogue sans facture
// chez nous est fournie par un concurrent.
//
// Le site tourne sous Apache nu, sans protection anti-robot, et son robots.txt
// n'interdit rien. On reste malgré tout courtois : douze fiches par passage, une
// seconde d'écart, soit un peu plus d'une requête par minute. Les 819 sont lues en
// une nuit sans que personne ne le remarque.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const RACINE = 'https://www.annuaire-arcade.fr';
const UA = 'Mozilla/5.0 (compatible; ArcadeOS/1.0; +https://avranchesautomatic.com)';
const BUDGET_MS = 110_000;
const PAR_PASSAGE = 12;
const PAUSE_MS = 1000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Les 25 prestations de l'annuaire. Une salle en porte souvent plusieurs — un bowling
// avec bar et laser game — d'où le tableau conservé en entier. Mais le copilote a besoin
// d'UN type principal pour répondre « les campings de Bretagne » sans ambiguïté : d'où
// cet ordre, du plus spécifique au plus générique. « Salle d'arcade » ferme la marche,
// c'est le type par défaut de l'annuaire et il ne distingue rien.
const PRESTATIONS: { code: string; libelle: string }[] = [
  { code: 'camping', libelle: 'camping' },
  { code: 'bowling', libelle: 'bowling' },
  { code: 'parc-dattraction', libelle: "parc d'attraction" },
  { code: 'laser-game', libelle: 'laser game' },
  { code: 'karting', libelle: 'karting' },
  { code: 'trampoline', libelle: 'trampoline' },
  { code: 'escape-game', libelle: 'escape game' },
  { code: 'realite-virtuelle', libelle: 'réalité virtuelle' },
  { code: 'casino', libelle: 'casino' },
  { code: 'cinema', libelle: 'cinéma' },
  { code: 'discotheque', libelle: 'discothèque' },
  { code: 'karaoke', libelle: 'karaoké' },
  { code: 'sport', libelle: 'complexe sportif' },
  { code: 'musee', libelle: 'musée' },
  { code: 'hotel', libelle: 'hôtel' },
  { code: 'restaurant', libelle: 'restaurant' },
  { code: 'cafe', libelle: 'café ludique' },
  { code: 'bar', libelle: 'bar' },
  { code: 'magasin-de-jeux-video', libelle: 'magasin' },
  { code: 'aire-dautoroute', libelle: "aire d'autoroute" },
  { code: 'aeroport', libelle: 'aéroport' },
  { code: 'quiz-box', libelle: 'quiz box' },
  { code: 'privatisation', libelle: 'privatisation' },
  { code: 'salle-de-jeux', libelle: 'aire de jeux' },
  { code: 'salle-darcade', libelle: "salle d'arcade" },
];

const CARTE = `${RACINE}/la-carte-de-france-des-salles-arcade/`;

/** Marqueurs d'une carte : identifiant de la salle, nom et position. */
function marqueurs(html: string): Map<string, { nom: string; lat: number; lng: number }> {
  const out = new Map<string, { nom: string; lat: number; lng: number }>();
  for (const m of html.matchAll(
    /L\.marker\(\[([-\d.]+),\s*([-\d.]+)\][\s\S]{0,400}?salle-arcade\\?\/([a-z0-9-]+)\\?\/[^>]*>([^<]{1,120})</g)) {
    const [, lat, lng, slug, nom] = m;
    if (!out.has(slug)) out.set(slug, { nom: decode(nom), lat: Number(lat), lng: Number(lng) });
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

async function page(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    // Toujours lire ou annuler le corps : une réponse abandonnée en l'état retient sa
    // mémoire, et c'est ce qui avait fait sauter la limite de la gazette.
    res.body?.cancel();
    throw new Error(`HTTP ${res.status} sur ${url}`);
  }
  return await res.text();
}

// ── Extraction d'une fiche ─────────────────────────────────────────────────────
type Machine = { slug: string; nom: string | null; categorie: string; genre: string | null; annee: number | null; editeur: string | null };

function extraire(html: string, slug: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '';
  const nom = decode(h1.replace(/<[^>]+>/g, ' ')) || null;

  // Le bloc d'adresse est le seul <div class=""> contenant un code postal suivi d'une
  // ville. Repérage par le contenu plutôt que par la classe, qui est vide.
  const adr = html.match(/<div class="">\s*([^<]{4,120}?)\s*<br\s*\/?>\s*(\d{5})\s+([^<]{2,60}?)\s*<\/div>/);
  const adresse = adr ? decode(adr[1]) : null;
  const codePostal = adr ? adr[2] : null;
  const ville = adr ? decode(adr[3]) : null;

  const liens = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const social = (reseau: string) =>
    liens.find((u) => new RegExp(`${reseau}\\.com/`, 'i').test(u) && !/annuairearcade/i.test(u)) ?? null;
  const siteWeb = liens.find((u) =>
    !/annuaire-arcade|facebook|instagram|twitter|x\.com|youtube|gravatar|w\.org|gmpg|schema\.org|google|openstreetmap|wordpress|tile\./i.test(u)
  ) ?? null;

  // Machines. Chaque modèle apparaît deux fois sur la page : une vignette dans la
  // liste, puis une fiche détaillée plus bas. Les métadonnées ne sont que dans la
  // seconde. On délimite donc, pour chaque occurrence, une fenêtre qui S'ARRÊTE au
  // lien de la machine suivante — sans cette borne, l'année et l'éditeur d'un modèle
  // seraient attribués au précédent, et le brief affirmerait des faussetés.
  const liensMachine = [...html.matchAll(/\/(jeu|flipper)\/([a-z0-9-]+)\//g)]
    .map((m) => ({ pos: m.index ?? 0, categorie: m[1] === 'flipper' ? 'flipper' : 'jeu', slug: m[2] }));

  const machines = new Map<string, Machine>();
  for (let i = 0; i < liensMachine.length; i++) {
    const { pos, categorie, slug: s } = liensMachine[i];
    let fin = html.length;
    for (let j = i + 1; j < liensMachine.length; j++) {
      if (liensMachine[j].slug !== s) { fin = liensMachine[j].pos; break; }
    }
    const plat = decode(html.slice(pos, Math.min(fin, pos + 6000)).replace(/<[^>]+>/g, ' | '))
      .replace(/(\s*\|\s*)+/g, ' | ');
    const lire = (etiquette: string, valeur: string) =>
      plat.match(new RegExp(`\\|\\s*${etiquette}\\s*\\|\\s*(${valeur})\\s*\\|`, 'i'))?.[1]?.trim() ?? null;
    const annee = Number(lire('Ann[ée]e', '\\d{4}') ?? '');
    const trouve: Machine = {
      slug: s, categorie,
      nom: plat.match(/\|\s*([^|]{2,70}?)\s*\|\s*Genre\s*\|/i)?.[1]?.trim() ?? null,
      genre: lire('Genre', '[^|]{2,50}?'),
      annee: Number.isFinite(annee) && annee > 1950 && annee < 2100 ? annee : null,
      editeur: lire('Editeur', '[^|]{2,50}?'),
    };
    // Une machine peut n'avoir aucune fiche détaillée sur CETTE page : on retient la
    // version la mieux renseignée, les huit cents autres pages complèteront le reste.
    const ancien = machines.get(s);
    const richesse = (m: Machine | undefined) =>
      m ? [m.nom, m.genre, m.annee, m.editeur].filter((v) => v !== null).length : -1;
    if (richesse(trouve) > richesse(ancien)) machines.set(s, trouve);
  }

  return {
    slug, nom, adresse, code_postal: codePostal, ville,
    departement: departementDepuisCP(codePostal),
    region: regionDepuisCP(codePostal),
    site_web: siteWeb, facebook: social('facebook'), instagram: social('instagram'),
    machines: [...machines.values()],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const isCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET;
  if (!isCron) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    if (!(roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction'))
      return json({ error: 'Forbidden' }, 403);
  }

  const debut = Date.now();
  try {
    const body = await req.json().catch(() => ({}));

    // ── Squelette : les 819 adresses de fiches, en une requête ─────────────────
    if (body.action === 'squelette') {
      const plan = await page(`${RACINE}/salle_arcade-sitemap.xml`);
      const urls = [...new Set([...plan.matchAll(/https:\/\/www\.annuaire-arcade\.fr\/salle-arcade\/([a-z0-9-]+)\//g)]
        .map((m) => m[0]))];
      if (urls.length === 0) return json({ error: 'Plan du site illisible' }, 502);

      const lignes = urls.map((u) => ({ slug: u.match(/salle-arcade\/([a-z0-9-]+)\//)![1], fiche_url: u }));
      for (let i = 0; i < lignes.length; i += 300) {
        const { error } = await admin.from('arcade_salles')
          .upsert(lignes.slice(i, i + 300), { onConflict: 'slug', ignoreDuplicates: true });
        if (error) throw error;
      }
      const { count } = await admin.from('arcade_salles').select('id', { count: 'exact', head: true });
      return json({ ok: true, trouvees: urls.length, en_base: count ?? 0 });
    }

    // ── Carte : type de lieu et coordonnées, en 26 requêtes ───────────────────
    // La page carte porte, pour CHAQUE salle, sa position et ses prestations — ces
    // dernières via un filtre en paramètre d'URL. Vingt-six requêtes suffisent donc à
    // classer et géolocaliser les 819 salles, là où un géocodage adresse par adresse
    // aurait demandé autant d'appels à un service externe pour un résultat moins sûr.
    if (body.action === 'carte') {
      const base = marqueurs(await page(CARTE));
      if (base.size === 0) return json({ error: 'Aucun marqueur sur la carte' }, 502);

      const parSalle = new Map<string, string[]>();
      const comptes: Record<string, number> = {};
      for (const p of PRESTATIONS) {
        if (Date.now() - debut > BUDGET_MS) break;
        const filtres = marqueurs(await page(`${CARTE}?typeEtablissement=${p.code}`));
        comptes[p.libelle] = filtres.size;
        for (const slug of filtres.keys()) {
          const l = parSalle.get(slug) ?? [];
          l.push(p.libelle);
          parSalle.set(slug, l);
        }
        await dormir(PAUSE_MS);
      }

      const lignes = [...base.entries()].map(([slug, m]) => {
        const prestations = parSalle.get(slug) ?? [];
        // Le type principal est le premier de la liste de priorité que la salle porte.
        const principal = PRESTATIONS.find((p) => prestations.includes(p.libelle))?.libelle ?? null;
        return {
          slug,
          fiche_url: `${RACINE}/salle-arcade/${slug}/`,
          nom: m.nom,
          lat: m.lat, lng: m.lng, geocode_at: new Date().toISOString(),
          type_lieu: principal,
          prestations,
          updated_at: new Date().toISOString(),
        };
      });
      for (let i = 0; i < lignes.length; i += 200) {
        const { error } = await admin.from('arcade_salles')
          .upsert(lignes.slice(i, i + 200), { onConflict: 'slug' });
        if (error) throw error;
      }
      return json({
        ok: true, salles: lignes.length,
        classees: lignes.filter((l) => l.type_lieu).length,
        par_prestation: comptes,
      });
    }

    // ── Lecture des fiches ─────────────────────────────────────────────────────
    const limite = Math.min(30, Math.max(1, Number(body.limite ?? PAR_PASSAGE)));
    const { data: aLire, error: eSel } = await admin
      .from('arcade_salles').select('id, slug, fiche_url')
      .is('fiche_lue_at', null).limit(limite);
    if (eSel) throw eSel;
    if (!aLire?.length) {
      return json({ ok: true, lues: 0, termine: true, message: 'Toutes les fiches sont lues.' });
    }

    let lues = 0, machinesVues = 0, echecs = 0;
    const details: string[] = [];

    for (const salle of aLire) {
      if (Date.now() - debut > BUDGET_MS) break;
      try {
        const f = extraire(await page(salle.fiche_url), salle.slug);

        const { error: eMaj } = await admin.from('arcade_salles').update({
          // Le nom de la carte fait foi quand il existe : celui du titre de page est
          // parfois tronqué ou suffixé.
          ...(salle.nom ? {} : { nom: f.nom }),
          adresse: f.adresse, code_postal: f.code_postal, ville: f.ville,
          departement: f.departement, region: f.region,
          site_web: f.site_web, facebook: f.facebook, instagram: f.instagram,
          fiche_lue_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', salle.id);
        if (eMaj) throw eMaj;

        if (f.machines.length) {
          // Le catalogue de machines se complète au fil des fiches : un modèle croisé
          // sur huit cents salles finit par livrer ses métadonnées quelque part. Rien
          // ne sert d'aller lire ses 1 076 pages dédiées.
          const { error: eM } = await admin.from('arcade_machines').upsert(
            f.machines.map((m) => ({
              slug: m.slug, nom: m.nom ?? m.slug.replace(/-/g, ' '),
              categorie: m.categorie, type_jeu: m.genre, annee: m.annee, editeur: m.editeur,
              fiche_url: `${RACINE}/${m.categorie}/${m.slug}/`,
            })), { onConflict: 'slug', ignoreDuplicates: true });
          if (eM) throw eM;

          const { error: eP } = await admin.from('arcade_parc').upsert(
            f.machines.map((m) => ({ salle_id: salle.id, machine_slug: m.slug })),
            { onConflict: 'salle_id,machine_slug', ignoreDuplicates: true });
          if (eP) throw eP;
          machinesVues += f.machines.length;
        }

        lues++;
        if (details.length < 5) details.push(`${f.nom ?? salle.slug} · ${f.ville ?? '?'} · ${f.machines.length} machines`);
      } catch (e) {
        // Une fiche qui échoue N'EST PAS marquée lue : elle repassera au tour suivant.
        // C'est l'inverse du choix fait pour la gazette, et volontairement : ici
        // l'échec est presque toujours un incident réseau, pas une page introuvable.
        echecs++;
        if (details.length < 8) details.push(`échec ${salle.slug} : ${(e as Error).message.slice(0, 80)}`);
      }
      await dormir(PAUSE_MS);
    }

    const { count: restants } = await admin.from('arcade_salles')
      .select('id', { count: 'exact', head: true }).is('fiche_lue_at', null);

    return json({ ok: true, lues, echecs, machines_vues: machinesVues, restants: restants ?? 0, details });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
