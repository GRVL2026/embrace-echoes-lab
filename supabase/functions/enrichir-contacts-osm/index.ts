import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { cle, cleIdentifiante, metres, similarite } from '../_shared/rapprochement.ts';

// Téléphone, site web et adresse de contact, lus dans OpenStreetMap AUTOUR de chaque
// fiche.
//
// POURQUOI UNE SECONDE FONCTION PLUTÔT QUE D'ÉTENDRE LA PREMIÈRE
//
// enrichir-prospects-osm demande à Overpass « tous les campings du département », puis
// apparie. Cette approche convient à une catégorie rare et dispersée. Elle s'effondre
// sur des bars en ville : Paris en compte des milliers, la réponse est énorme, et
// Overpass a fini par ne plus répondre du tout — deux tentatives, la seconde coupée à
// 150 s.
//
// Ici on part de l'autre bout. Les fiches sont DÉJÀ géocodées à l'adresse par
// api-adresse ; on demande donc « ce qui porte un nom dans un rayon de quatre-vingts
// mètres autour de ces cinquante points ». La requête est cent fois plus légère, et
// l'appariement bien plus sûr : on ne compare que des objets déjà au bon endroit.
//
// L'appariement reste BIUNIVOQUE. Sans cela, dans une galerie marchande, huit commerces
// se verraient attribuer le même téléphone — c'est le défaut qui avait été corrigé sur
// les campings vendéens, il n'y a pas de raison de le réintroduire.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// L'instance principale limite fortement le débit vu depuis un hébergeur mutualisé,
// dont l'adresse IP est partagée. kumi.systems est plus rapide et plus permissif.
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
// Overpass refuse par un 406 les clients qui ne s'identifient pas.
const UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)';

// Vingt-cinq points par requête, mesuré : la requête aboutit en une trentaine de
// secondes et rend quelque neuf cents objets. Ce n'est PAS la taille qui limite —
// des lots de cinq ont échoué quand vingt-cinq passaient. Les instances publiques
// distribuent des créneaux d'exécution ; quand aucun n'est libre elles répondent 504.
// C'est transitoire, et cela se traite par la patience, pas en réduisant le lot.
const LOT = 25;
const RAYON_M = 80;         // le géocodage est à l'adresse : au-delà, c'est le voisin
const SIM_MIN = 0.34;       // « Le Comptoir » contre « Comptoir Général » passe, pas deux inconnus
const BUDGET_MS = 110_000;  // les edge functions sont coupées à 150 s

type Fiche = { id: string; entreprise: string; lat: number; lng: number; cle: string; cleBrute: string };
type Objet = { lat: number; lon: number; t: Record<string, string>; id: string };

/** Première valeur non vide parmi plusieurs clés OSM : la même information s'écrit
 *  « phone », « contact:phone » ou « contact:mobile » selon le contributeur. */
function tag(t: Record<string, string>, ...cles: string[]): string | null {
  for (const k of cles) {
    const v = (t[k] ?? '').trim();
    if (v) return v;
  }
  return null;
}

/** Un site web doit être une adresse, pas une page Facebook mal recopiée ni un
 *  fragment. On normalise, et on rejette ce qui ne s'analyse pas. */
function siteValide(brut: string | null): string | null {
  if (!brut) return null;
  const v = brut.split(';')[0].trim();
  try {
    const u = new URL(v.startsWith('http') ? v : `https://${v}`);
    return u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Une seule requête pour tout le lot : autant de clauses « around » que de fiches,
 *  réunies en un groupe. On ne filtre pas par catégorie — un bar peut être étiqueté
 *  amenity=bar, =pub, =nightclub ou leisure=* selon le contributeur, et exiger la
 *  bonne étiquette ferait perdre plus que le bruit qu'on éviterait. Le nom tranchera. */
function requeteOverpass(points: { lat: number; lng: number }[]): string {
  const clauses = points
    .map((p) => `nwr["name"](around:${RAYON_M},${p.lat.toFixed(6)},${p.lng.toFixed(6)});`)
    .join('\n');
  return `[out:json][timeout:60];\n(\n${clauses}\n);\nout tags center;`;
}

async function interroger(points: Fiche[], echeance: number): Promise<Objet[]> {
  const q = requeteOverpass(points);

  // Deux passages sur les miroirs. Un 504 signifie « aucun créneau libre pour l'instant »
  // et se résorbe en quelques secondes : abandonner au premier refus, c'est renoncer
  // alors que la requête est bonne — mesuré, elle aboutit ailleurs ou un peu plus tard.
  let dernier = '';
  for (let essai = 0; essai < MIRRORS.length * 2; essai++) {
    if (Date.now() > echeance) throw new Error(`Temps imparti dépassé (${dernier || 'aucune réponse'})`);
    const url = MIRRORS[essai % MIRRORS.length];
    try {
      // SANS DÉLAI D'ATTENTE, fetch patiente indéfiniment : c'est ce qui faisait
      // dépasser les 150 s malgré le contrôle de temps, celui-ci n'intervenant
      // qu'ENTRE deux tentatives.
      // Une requête de vingt-cinq points aboutit en une trentaine de secondes : couper
      // à quarante serait couper des réponses en train d'arriver.
      const restant = Math.max(5_000, Math.min(55_000, echeance - Date.now()));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': UA,
        },
        body: new URLSearchParams({ data: q }).toString(),
        signal: AbortSignal.timeout(restant),
      });
      if (res.ok) {
        const data = await res.json();
        return ((data.elements ?? []) as any[])
          .map((e) => {
            const lat = e.lat ?? e.center?.lat;
            const lon = e.lon ?? e.center?.lon;
            return lat != null && lon != null
              ? { lat, lon, t: (e.tags ?? {}) as Record<string, string>, id: `${e.type}/${e.id}` }
              : null;
          })
          .filter(Boolean) as Objet[];
      }
      dernier = `HTTP ${res.status}`;
      res.body?.cancel();
    } catch (err) {
      dernier = String((err as any)?.message || err).slice(0, 120);
    }
    // Le créneau se libère en quelques secondes ; réessayer aussitôt ne fait que
    // consommer une tentative pour rien.
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`Overpass injoignable (${dernier})`);
}

/** Appariement biunivoque, puis écriture.
 *
 *  On note tous les couples plausibles, on les trie du meilleur au moins bon, et chaque
 *  objet comme chaque fiche ne peut être retenu qu'une seule fois. Sans cette contrainte,
 *  dans une galerie marchande, plusieurs commerces héritent du même téléphone — c'est le
 *  défaut qui avait été corrigé sur les campings vendéens. */
async function apparierEtEcrire(
  fiches: Fiche[], objets: Objet[], dryRun: boolean,
  // Le décompte du reste à faire dépend de la cible demandée — une source précise ou
  // toutes, avec ou sans segments écartés. Le caller le sait, pas cette fonction.
  compterRestants: () => Promise<{ count: number | null }>,
) {
  type Couple = { fi: number; oi: number; score: number; d: number; sim: number };
  const couples: Couple[] = [];
  for (let fi = 0; fi < fiches.length; fi++) {
    const f = fiches[fi];
    for (let oi = 0; oi < objets.length; oi++) {
      const o = objets[oi];
      const d = metres(f.lat, f.lng, o.lat, o.lon);
      if (d > RAYON_M) continue;
      const nom = o.t.name ?? '';
      const sim = Math.max(
        similarite(f.cle, cleIdentifiante(nom)),
        similarite(f.cleBrute, cle(nom)),
      );
      if (sim < SIM_MIN) continue;
      couples.push({ fi, oi, score: sim * 1000 + Math.max(0, RAYON_M - d), d, sim });
    }
  }
  couples.sort((a, b) => b.score - a.score);

  const fichePrise = new Set<number>(), objetPris = new Set<number>();
  const retenus: { f: Fiche; o: Objet; d: number; sim: number }[] = [];
  for (const c of couples) {
    if (fichePrise.has(c.fi) || objetPris.has(c.oi)) continue;
    fichePrise.add(c.fi); objetPris.add(c.oi);
    retenus.push({ f: fiches[c.fi], o: objets[c.oi], d: c.d, sim: c.sim });
  }

  let tel = 0, site = 0, mail = 0;
  const patches: { id: string; patch: Record<string, unknown> }[] = [];
  for (const r of retenus) {
    const patch: Record<string, unknown> = {};
    const t = tag(r.o.t, 'phone', 'contact:phone', 'contact:mobile');
    const w = siteValide(tag(r.o.t, 'website', 'contact:website', 'url'));
    const e = tag(r.o.t, 'email', 'contact:email');
    if (t) { patch.telephone = t; tel++; }
    if (w) { patch.site_web = w; site++; }
    if (e) { patch.email = e; mail++; }
    if (Object.keys(patch).length) patches.push({ id: r.f.id, patch });
  }

  const commun = {
    interroges: fiches.length, objets_osm: objets.length, apparies: retenus.length,
    telephones: tel, sites: site, emails: mail,
    apercu: retenus.slice(0, 10).map((r) =>
      `${r.f.entreprise} ↔ ${r.o.t.name} (${Math.round(r.d)} m, ${Math.round(r.sim * 100)} %)`
      + ` · ${[tag(r.o.t, 'phone', 'contact:phone') ? 'tél' : null,
               tag(r.o.t, 'website', 'contact:website') ? 'site' : null].filter(Boolean).join(' ') || '—'}`),
  };
  if (dryRun) return { mode: 'analyse', ...commun };

  // On n'écrase JAMAIS une valeur déjà présente : une donnée saisie à la main ou trouvée
  // sur le site officiel vaut mieux qu'une contribution anonyme.
  for (const { id, patch } of patches) {
    let q = admin.from('prospects').update(patch).eq('id', id);
    if (patch.telephone) q = q.is('telephone', null);
    const { error } = await q;
    if (error) throw error;
  }

  // Marquer TOUT le lot comme tenté, apparié ou non : sans cela les mêmes fiches
  // reviendraient à chaque appel et les suivantes ne seraient jamais interrogées.
  const { error: e3 } = await admin.from('prospects')
    .update({ osm_tente_at: new Date().toISOString() })
    .in('id', fiches.map((f) => f.id));
  if (e3) throw e3;

  const { count: restants } = await compterRestants();
  return { ...commun, restants: restants ?? 0 };
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
    const action = String(body.action ?? 'complet');
    // « * » vise toutes les sources. La fonction est née pour les cabines photo, mais le
    // manque de coordonnées touche TOUS les prospects qualifiés : les 771 salles de
    // l'annuaire arcade n'ont pas un seul téléphone, les 576 fiches « loisirs » non plus.
    // Ce sont pourtant les meilleurs — parc installé connu, argumentaire tout prêt — et
    // ils restent inappelables. Le goulot de la prospection est là, pas dans le découpage
    // des secteurs.
    const source = String(body.source ?? 'cabine-photo').trim();
    // Les campings sont déjà enrichis (1 243 joignables) : les repasser gaspillerait des
    // créneaux Overpass rares au lieu de servir ceux qui n'ont rien.
    const horsSegments: string[] = Array.isArray(body.hors_segments) ? body.hors_segments : [];
    const lot = Math.min(120, Math.max(1, Number(body.lot ?? LOT)));
    const dryRun = body.dry_run === true;

    /** Les fiches restant à interroger, selon la cible demandée. */
    const aInterroger = (limite: number) => {
      let q = admin.from('prospects')
        .select('id, entreprise, lat, lng')
        .is('osm_tente_at', null)
        .not('lat', 'is', null).not('lng', 'is', null);
      if (source !== '*') q = q.eq('source', source);
      if (horsSegments.length) q = q.not('segment', 'in', `(${horsSegments.join(',')})`);
      return q.limit(limite);
    };

    const compterRestants = () => {
      let q = admin.from('prospects')
        .select('id', { count: 'exact', head: true })
        .is('osm_tente_at', null).not('lat', 'is', null);
      if (source !== '*') q = q.eq('source', source);
      if (horsSegments.length) q = q.not('segment', 'in', `(${horsSegments.join(',')})`);
      return q;
    };

    // ── Relais depuis un poste de travail ─────────────────────────────────────
    // Overpass étrangle l'adresse IP de l'hébergeur, partagée avec d'autres locataires :
    // la même requête qui aboutit en trente secondes depuis une ligne ordinaire n'obtient
    // jamais de créneau depuis Supabase. Plutôt que de dupliquer l'appariement dans un
    // script, on découpe : « points » rend le lot ET la requête toute faite, le poste
    // n'a qu'à la poster et renvoyer la réponse brute à « elements », qui apparie et
    // écrit. Le poste ne connaît aucune clé de service et ne décide de rien.
    if (action === 'points' || action === 'elements') {
      const fiches: Fiche[] = (body.fiches ?? []).map((f: any) => ({
        id: String(f.id), entreprise: String(f.entreprise ?? ''),
        lat: Number(f.lat), lng: Number(f.lng),
        cle: cleIdentifiante(f.entreprise), cleBrute: cle(f.entreprise),
      }));

      if (action === 'points') {
        const { data, error: e1 } = await aInterroger(lot);
        if (e1) throw e1;
        const { count } = await compterRestants();
        return json({ ok: true, fiches: data ?? [], restants: count ?? 0,
          requete: requeteOverpass((data ?? []).map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))) });
      }

      const objets: Objet[] = (body.elements ?? [])
        .map((e: any) => {
          const lat = e.lat ?? e.center?.lat;
          const lon = e.lon ?? e.center?.lon;
          return lat != null && lon != null
            ? { lat, lon, t: (e.tags ?? {}) as Record<string, string>, id: `${e.type}/${e.id}` }
            : null;
        })
        .filter(Boolean) as Objet[];
      return json({ ok: true, ...(await apparierEtEcrire(fiches, objets, dryRun, compterRestants)) });
    }

    const { data: brutes, error } = await aInterroger(lot);
    if (error) throw error;
    if (!brutes?.length) return json({ ok: true, traites: 0, termine: true });

    const fiches: Fiche[] = brutes.map((p: any) => ({
      id: String(p.id),
      entreprise: String(p.entreprise ?? ''),
      lat: Number(p.lat), lng: Number(p.lng),
      cle: cleIdentifiante(p.entreprise),
      cleBrute: cle(p.entreprise),
    }));

    const objets = await interroger(fiches, debut + BUDGET_MS);
    return json({ ok: true, ...(await apparierEtEcrire(fiches, objets, dryRun, compterRestants)) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
