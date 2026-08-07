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

const LOT = 50;             // points par requête Overpass
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

async function interroger(points: Fiche[], echeance: number): Promise<Objet[]> {
  // Une seule requête pour tout le lot : autant de clauses « around » que de fiches,
  // réunies en un groupe. On ne filtre pas par catégorie — un bar peut être étiqueté
  // amenity=bar, =pub, =nightclub ou leisure=* selon le contributeur, et exiger la
  // bonne étiquette ferait perdre plus que le bruit qu'on éviterait. Le nom tranchera.
  const clauses = points
    .map((p) => `nwr(around:${RAYON_M},${p.lat.toFixed(6)},${p.lng.toFixed(6)})["name"];`)
    .join('\n');
  const q = `[out:json][timeout:60];\n(\n${clauses}\n);\nout center tags;`;

  let dernier = '';
  for (let essai = 0; essai < MIRRORS.length; essai++) {
    if (Date.now() > echeance) throw new Error(`Temps imparti dépassé (${dernier || 'aucune réponse'})`);
    const url = MIRRORS[essai % MIRRORS.length];
    try {
      // SANS DÉLAI D'ATTENTE, fetch patiente indéfiniment : c'est ce qui faisait
      // dépasser les 150 s malgré le contrôle de temps, celui-ci n'intervenant
      // qu'ENTRE deux tentatives.
      const restant = Math.max(5_000, Math.min(40_000, echeance - Date.now()));
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
    await new Promise((r) => setTimeout(r, 1500 * (essai + 1)));
  }
  throw new Error(`Overpass injoignable (${dernier})`);
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
    const source = String(body.source ?? 'cabine-photo').trim();
    const lot = Math.min(120, Math.max(1, Number(body.lot ?? LOT)));
    const dryRun = body.dry_run === true;

    const { data: brutes, error } = await admin.from('prospects')
      .select('id, entreprise, lat, lng')
      .eq('source', source)
      .is('osm_tente_at', null)
      .not('lat', 'is', null).not('lng', 'is', null)
      .limit(lot);
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

    // --- Appariement biunivoque -------------------------------------------------
    // On note tous les couples plausibles, on les trie du meilleur au moins bon, et
    // chaque objet comme chaque fiche ne peut être retenu qu'une seule fois. Dans une
    // galerie marchande, deux commerces voisins ne doivent pas hériter du même numéro.
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

    if (dryRun) {
      return json({ ok: true, mode: 'analyse', interroges: fiches.length,
        objets_osm: objets.length, apparies: retenus.length,
        telephones: tel, sites: site, emails: mail,
        apercu: retenus.slice(0, 10).map((r) =>
          `${r.f.entreprise} ↔ ${r.o.t.name} (${Math.round(r.d)} m, ${Math.round(r.sim * 100)} %)`
          + ` · ${[tag(r.o.t, 'phone', 'contact:phone') ? 'tél' : null,
                   tag(r.o.t, 'website', 'contact:website') ? 'site' : null].filter(Boolean).join(' ') || '—'}`) });
    }

    // On n'écrase JAMAIS une valeur déjà présente : une donnée saisie à la main ou
    // trouvée sur le site officiel vaut mieux qu'une contribution anonyme.
    for (const { id, patch } of patches) {
      let q = admin.from('prospects').update(patch).eq('id', id);
      if (patch.telephone) q = q.is('telephone', null);
      const { error: e2 } = await q;
      if (e2) throw e2;
    }

    // Marquer TOUT le lot comme tenté, apparié ou non : sans cela les mêmes fiches
    // reviendraient à chaque appel et les suivantes ne seraient jamais interrogées.
    const { error: e3 } = await admin.from('prospects')
      .update({ osm_tente_at: new Date().toISOString() })
      .in('id', fiches.map((f) => f.id));
    if (e3) throw e3;

    const { count: restants } = await admin.from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('source', source).is('osm_tente_at', null).not('lat', 'is', null);

    return json({ ok: true, interroges: fiches.length, objets_osm: objets.length,
      apparies: retenus.length, telephones: tel, sites: site, emails: mail,
      restants: restants ?? 0 });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
