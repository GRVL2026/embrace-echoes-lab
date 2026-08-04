import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Enrichit les prospects importés depuis l'INSEE avec les données OpenStreetMap :
// classement en étoiles, téléphone, e-mail, site web, capacité, et surtout l'ENSEIGNE
// réelle du réseau (Capfun, Siblu, Sunêlia…), que l'INSEE ne connaît pas.
//
// Source : Overpass API, gratuite et sans clé. Mesuré sur la Vendée (356 campings) :
// étoiles 64 %, site web 57 %, téléphone 47 %, SIRET 29 %, e-mail 20 %, operator 17 %.
// La couverture varie fortement d'un département à l'autre — la réponse la détaille.
//
// Rapprochement en deux temps : SIRET exact (fiable), puis proximité géographique
// complétée par la similarité de nom. Les deux jeux ont des coordonnées.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Plusieurs miroirs Overpass : l'instance principale limite fortement le débit (429) vu
// depuis un hébergeur mutualisé, dont l'adresse IP est partagée avec d'autres locataires.
// kumi.systems est plus rapide et plus permissif, on le sollicite en premier.
const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
// Overpass refuse par un 406 les clients qui ne s'identifient pas : cette en-tête est
// obligatoire, comme pour Nominatim dans la fonction geocoder.
const OVERPASS_UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)';
const DEPS_PAR_APPEL = 3;        // Overpass est lent : peu de départements par invocation
const BUDGET_MS = 110_000;       // les edge functions sont coupées à 150 s : on rend la main avant
const DIST_MAX_M = 1500;         // au-delà, on n'apparie plus (les coordonnées INSEE sont approximatives)
const SCORE_NOM_MIN = 0.5;       // au moins la moitié des mots du nom le plus court en commun
const PAUSE_OVERPASS_MS = 1500;  // service mutualisé : rester courtois

type OsmEl = {
  type: string; id: number; lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const nb = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Mots qui n'identifient pas un camping : formes juridiques, termes génériques du secteur,
// articles. Les retirer évite d'apparier « SARL CAMPING LE PRE » avec « CAMPING LES PINS »
// sur les seuls mots « sarl » et « camping ».
const MOTS_VIDES = new Set([
  'sarl', 'sas', 'sasu', 'sa', 'sci', 'eurl', 'snc', 'scea', 'gaec', 'sarlu', 'ste', 'societe',
  'camping', 'campings', 'caravaning', 'hpa', 'hotellerie', 'plein', 'air', 'village',
  'vacances', 'residence', 'exploitation', 'loisirs', 'tourisme',
  'le', 'la', 'les', 'du', 'de', 'des', 'un', 'une', 'au', 'aux', 'sur', 'sous', 'et',
]);

// Normalisation pour comparer des noms de campings :
// « Camping Les Dauphins Bleus » et « LES DAUPHINS-BLEUS » doivent se rejoindre.
// Le suffixe « — COMMUNE » est ajouté par l'import quand l'établissement n'a pas d'enseigne :
// il n'appartient pas au nom réel et fausserait la comparaison.
function normNom(s: string): string {
  return (s ?? '')
    .split(/[—–]/)[0]
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jetons(s: string): Set<string> {
  return new Set(normNom(s).split(' ').filter((t) => t.length >= 3 && !MOTS_VIDES.has(t)));
}

// Proportion des mots du nom le plus court que l'on retrouve dans l'autre.
// Plus tolérant qu'un Jaccard : « Camping de l'Océan » et « SARL CAMPING L'OCEAN » se
// rejoignent bien, alors qu'ils n'ont qu'un mot commun sur des longueurs différentes.
function scoreNom(a: string, b: string): { score: number; motFort: boolean } {
  const ja = jetons(a), jb = jetons(b);
  if (ja.size === 0 || jb.size === 0) return { score: 0, motFort: false };
  let inter = 0, motFort = false;
  for (const t of ja) {
    if (jb.has(t)) { inter++; if (t.length >= 4) motFort = true; }
  }
  return { score: inter / Math.min(ja.size, jb.size), motFort };
}

// Préfixe de code postal d'un département : la Corse (2A/2B) et l'outre-mer (971…)
// ne suivent pas la règle habituelle « département = deux premiers chiffres ».
function cpPrefixe(dep: string): string {
  const d = dep.trim().toUpperCase();
  if (d === '2A' || d === '2B') return '20';
  if (d.length === 3) return d;
  return d.padStart(2, '0');
}

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// tents / caravans / cabins valent un nombre d'emplacements, ou « yes » (non chiffré).
function capacite(t: Record<string, string>): number | null {
  let total = 0, vu = false;
  for (const k of ['tents', 'caravans', 'cabins', 'permanent_camping', 'capacity']) {
    const n = nb(t[k]);
    if (n !== null && n > 0) { total += n; vu = true; }
  }
  return vu ? total : null;
}

function etoiles(t: Record<string, string>): number | null {
  const s = nb((t.stars ?? '').replace(',', '.'));
  return s !== null && s >= 1 && s <= 5 ? Math.round(s) : null;
}

async function interrogerOverpass(dep: string, osmFiltre: string, echeance: number): Promise<OsmEl[]> {
  const q = `[out:json][timeout:120];
area["ref:INSEE"="${dep}"]["admin_level"="6"]->.a;
nwr${osmFiltre}(area.a);
out center;`;
  // On fait le tour des miroirs, deux passages, avec une attente croissante :
  // un 429 (débit dépassé) ou un 504 se résorbe généralement en quelques secondes.
  let dernierEchec = '';
  for (let essai = 0; essai < OVERPASS_MIRRORS.length * 2; essai++) {
    // Le temps imparti prime sur l'obstination : mieux vaut rendre la main proprement,
    // avec un département à reprendre, que d'être coupé net à 150 s.
    if (Date.now() > echeance) throw new Error(`Temps imparti dépassé avant d'interroger Overpass (dép. ${dep})`);
    const url = OVERPASS_MIRRORS[essai % OVERPASS_MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': OVERPASS_UA,
        },
        body: new URLSearchParams({ data: q }).toString(),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.elements ?? []) as OsmEl[];
      }
      const corps = await res.text().catch(() => '');
      dernierEchec = `${res.status} sur ${new URL(url).host} — ${corps.slice(0, 120)}`;
      // Un refus définitif (autre que débit / indisponibilité) ne sera pas levé par une reprise.
      if (![429, 502, 503, 504].includes(res.status)) break;
    } catch (err) {
      dernierEchec = `${new URL(url).host} injoignable — ${String((err as any)?.message || err).slice(0, 120)}`;
    }
    await new Promise((r) => setTimeout(r, 2000 * (1 + Math.floor(essai / OVERPASS_MIRRORS.length))));
  }
  throw new Error(`Overpass indisponible pour le département ${dep} : ${dernierEchec}`);
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

  try {
    const body = await req.json().catch(() => ({}));
    const segment = String(body.segment ?? 'camping').trim();
    const osmFiltre = String(body.osm_filtre ?? '["tourism"="camp_site"]').trim();
    const dryRun = body.dry_run === true;
    const deps: string[] = Array.isArray(body.departements)
      ? body.departements.map((d: unknown) => String(d).trim()).filter(Boolean)
      : String(body.departements ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (deps.length === 0) return json({ error: "Paramètre « departements » requis (ex. « 85 »)." }, 400);

    // Overpass est lent et sujet aux reprises : c'est le TEMPS qui décide du nombre de
    // départements traités, pas un compte fixe. Les edge functions sont coupées à 150 s.
    const debut = Date.now();
    const aTraiter: string[] = [];
    const restants: string[] = [];
    for (const d of deps) {
      if (aTraiter.length < DEPS_PAR_APPEL) aTraiter.push(d);
      else restants.push(d);
    }
    const detail: Record<string, unknown> = {};
    let apparies = 0, majEtoiles = 0, majTel = 0, majMail = 0, majSite = 0, majCapacite = 0, majEnseigne = 0;

    for (let i = 0; i < aTraiter.length; i++) {
      const dep = aTraiter[i];
      // On rend la main avant d'être coupé : les départements non traités repartent
      // dans « departements_restants » pour l'invocation suivante.
      if (Date.now() - debut > BUDGET_MS) { restants.unshift(...aTraiter.slice(i)); break; }
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_OVERPASS_MS));

      // Un département qui échoue (Overpass indisponible, temps écoulé) ne doit pas faire
      // perdre le travail des précédents : on le renvoie dans les restants et on s'arrête.
      let elements: OsmEl[];
      try {
        elements = await interrogerOverpass(dep, osmFiltre, debut + BUDGET_MS);
      } catch (err) {
        detail[dep] = { erreur: String((err as any)?.message || err).slice(0, 200) };
        restants.unshift(...aTraiter.slice(i));
        break;
      }
      const osm = elements
        .map((e) => {
          const lat = e.lat ?? e.center?.lat;
          const lon = e.lon ?? e.center?.lon;
          return lat != null && lon != null ? { lat, lon, t: e.tags ?? {}, id: `${e.type}/${e.id}` } : null;
        })
        .filter(Boolean) as { lat: number; lon: number; t: Record<string, string>; id: string }[];

      // Prospects du département : on filtre sur le code postal contenu dans l'adresse.
      const { data: prospects, error } = await admin
        .from('prospects')
        .select('id, entreprise, siret, lat, lng, adresse, groupe, telephone, email, site_web')
        .eq('segment', segment)
        .eq('source', 'naf')
        .not('lat', 'is', null)
        .like('adresse', `%${cpPrefixe(dep)}___ %`);
      if (error) throw error;

      // --- Appariement biunivoque ---------------------------------------------------
      // Une première version prenait « l'objet OSM le plus proche à moins de 250 m » sans
      // contrôler le nom ni empêcher les réemplois : sur le littoral vendéen, 8 sociétés
      // se sont retrouvées rattachées au MÊME camping, donc au même téléphone. Désormais
      // on note tous les couples plausibles, on les trie, et chaque objet OSM comme chaque
      // prospect ne peut être retenu qu'une seule fois. Dans le doute, on n'écrit rien.
      type Couple = { pi: number; oi: number; score: number; d: number; methode: string; nomOsm: string; sn: number };
      const couples: Couple[] = [];
      const listeP = prospects ?? [];

      for (let pi = 0; pi < listeP.length; pi++) {
        const p = listeP[pi];
        for (let oi = 0; oi < osm.length; oi++) {
          const o = osm[oi];
          const d = Math.round(distanceM(Number(p.lat), Number(p.lng), o.lat, o.lon));

          // Le SIRET est une identification certaine : il l'emporte, quelle que soit la distance.
          const siretOsm = (o.t['ref:FR:SIRET'] ?? '').replace(/\s/g, '');
          if (p.siret && siretOsm && siretOsm === String(p.siret)) {
            couples.push({ pi, oi, score: 10_000, d, methode: 'siret', nomOsm: o.t.name ?? '', sn: 1 });
            continue;
          }

          if (d > DIST_MAX_M) continue;
          const { score: sn, motFort } = scoreNom(p.entreprise ?? '', o.t.name ?? '');
          // Le nom est désormais obligatoire, et doit partager au moins un mot d'au
          // moins 4 lettres : « mer » ou « sud » ne suffisent pas à identifier un camping.
          if (!motFort || sn < SCORE_NOM_MIN) continue;
          couples.push({ pi, oi, score: 1000 * sn - d / 10, d, methode: 'nom+distance', nomOsm: o.t.name ?? '', sn });
        }
      }

      couples.sort((a, b) => b.score - a.score);
      const pPris = new Set<number>(), oPris = new Set<number>();
      let apparieDep = 0;
      const maj: Record<string, unknown>[] = [];

      for (const c of couples) {
        if (pPris.has(c.pi) || oPris.has(c.oi)) continue;
        pPris.add(c.pi); oPris.add(c.oi);

        const p = listeP[c.pi];
        const t = osm[c.oi].t;
        const e = etoiles(t);          if (e !== null) majEtoiles++;
        const cap = capacite(t);       if (cap !== null) majCapacite++;
        // On ne remplace jamais une donnée déjà présente en base.
        const tel  = !p.telephone && t.phone   ? t.phone   : null; if (tel)  majTel++;
        const mail = !p.email     && t.email   ? t.email   : null; if (mail) majMail++;
        const site = !p.site_web  && t.website ? t.website : null; if (site) majSite++;
        // L'enseigne OSM prime : elle nomme le réseau réel (Capfun) là où l'INSEE
        // ne voit qu'une société par camping.
        const enseigne = (t.operator || t.brand) && !p.groupe ? (t.operator || t.brand) : null;
        if (enseigne) majEnseigne++;

        apparies++; apparieDep++;
        maj.push({
          id: p.id,
          osm_id: osm[c.oi].id,
          // Traçabilité : permet de réauditer chaque appariement après coup.
          osm_match: {
            nom_osm: c.nomOsm, distance_m: c.d, methode: c.methode,
            score_nom: Math.round(c.sn * 100) / 100,
          },
          etoiles: e, capacite: cap, telephone: tel, email: mail,
          site_web: site, groupe: enseigne,
        });
      }

      // Une seule écriture pour tout le département : la version précédente envoyait une
      // requête par camping (161 allers-retours pour la seule Charente-Maritime), ce qui
      // suffisait à dépasser la limite de 150 s des edge functions.
      if (!dryRun && maj.length) {
        const { error: e2 } = await admin.rpc('appliquer_enrichissement_osm', { _maj: maj });
        if (e2) throw e2;
      }

      detail[dep] = {
        prospects_en_base: (prospects ?? []).length,
        objets_osm: osm.length,
        apparies: apparieDep,
        taux: (prospects ?? []).length
          ? `${Math.round((100 * apparieDep) / (prospects ?? []).length)} %`
          : '—',
      };
    }

    // Deuxième filet : un dirigeant présent sur plusieurs campings révèle un réseau que
    // l'INSEE ne déclare pas (une société par site). Complète les enseignes manquantes.
    let reseaux: unknown = null;
    if (!dryRun) {
      const { data, error } = await admin.rpc('consolider_prospects_naf');
      if (error) throw error;
      reseaux = data;
    }

    return json({
      ok: true, dry_run: dryRun, segment,
      departements_traites: aTraiter,
      detail_par_departement: detail,
      apparies,
      enrichissements: {
        etoiles: majEtoiles, telephone: majTel, email: majMail,
        site_web: majSite, capacite: majCapacite, enseigne: majEnseigne,
      },
      consolidation: reseaux,
      departements_restants: restants.length ? restants : null,
      termine: restants.length === 0,
    });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
