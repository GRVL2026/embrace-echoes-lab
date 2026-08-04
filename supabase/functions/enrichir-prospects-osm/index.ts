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

const OVERPASS = 'https://overpass-api.de/api/interpreter';
// Overpass refuse par un 406 les clients qui ne s'identifient pas : cette en-tête est
// obligatoire, comme pour Nominatim dans la fonction geocoder.
const OVERPASS_UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)';
const DEPS_PAR_APPEL = 4;        // Overpass est lent : peu de départements par invocation
const DIST_SURE_M = 250;         // en deçà, la proximité suffit
const DIST_MAX_M = 600;          // au-delà, on n'apparie plus
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

// Normalisation pour comparer des noms de campings :
// « Camping Les Dauphins Bleus » et « LES DAUPHINS-BLEUS » doivent se rejoindre.
function normNom(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(camping|campings|hpa|village|vacances|le|la|les|du|de|des|d|l|au|aux)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jetons(s: string): Set<string> {
  return new Set(normNom(s).split(' ').filter((t) => t.length >= 3));
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

async function interrogerOverpass(dep: string, osmFiltre: string): Promise<OsmEl[]> {
  const q = `[out:json][timeout:120];
area["ref:INSEE"="${dep}"]["admin_level"="6"]->.a;
nwr${osmFiltre}(area.a);
out center;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': OVERPASS_UA,
    },
    body: new URLSearchParams({ data: q }).toString(),
  });
  if (!res.ok) {
    const corps = await res.text().catch(() => '');
    throw new Error(`Overpass ${res.status} sur le département ${dep} — ${corps.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.elements ?? []) as OsmEl[];
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

    const aTraiter = deps.slice(0, DEPS_PAR_APPEL);
    const restants = deps.slice(DEPS_PAR_APPEL);
    const detail: Record<string, unknown> = {};
    let apparies = 0, majEtoiles = 0, majTel = 0, majMail = 0, majSite = 0, majCapacite = 0, majEnseigne = 0;

    for (let i = 0; i < aTraiter.length; i++) {
      const dep = aTraiter[i];
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_OVERPASS_MS));

      const elements = await interrogerOverpass(dep, osmFiltre);
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
        .like('adresse', `%${dep.padStart(2, '0')}___ %`);
      if (error) throw error;

      const parSiret = new Map<string, typeof osm[number]>();
      for (const o of osm) {
        const s = o.t['ref:FR:SIRET'];
        if (s) parSiret.set(s.replace(/\s/g, ''), o);
      }

      let apparieDep = 0;
      const maj: { id: string; patch: Record<string, unknown> }[] = [];

      for (const p of prospects ?? []) {
        let trouve = p.siret ? parSiret.get(String(p.siret)) ?? null : null;

        if (!trouve) {
          // Proximité : le plus proche sous 250 m, sinon sous 600 m avec un nom compatible.
          const jp = jetons(p.entreprise ?? '');
          let meilleur: { o: typeof osm[number]; d: number } | null = null;
          for (const o of osm) {
            const d = distanceM(Number(p.lat), Number(p.lng), o.lat, o.lon);
            if (d > DIST_MAX_M) continue;
            const nomOk = d <= DIST_SURE_M
              ? true
              : [...jetons(o.t.name ?? '')].some((t) => jp.has(t));
            if (!nomOk) continue;
            if (!meilleur || d < meilleur.d) meilleur = { o, d };
          }
          trouve = meilleur?.o ?? null;
        }
        if (!trouve) continue;

        const t = trouve.t;
        const patch: Record<string, unknown> = { osm_id: trouve.id };
        const e = etoiles(t);            if (e !== null) { patch.etoiles = e; majEtoiles++; }
        const cap = capacite(t);         if (cap !== null) { patch.capacite = cap; majCapacite++; }
        // On ne remplace jamais une donnée déjà présente en base.
        if (!p.telephone && t.phone)     { patch.telephone = t.phone; majTel++; }
        if (!p.email && t.email)         { patch.email = t.email; majMail++; }
        if (!p.site_web && t.website)    { patch.site_web = t.website; majSite++; }
        // L'enseigne OSM prime : elle nomme le réseau réel (Capfun) là où l'INSEE
        // ne voit qu'une société par camping.
        const enseigne = t.operator || t.brand;
        if (enseigne && !p.groupe)       { patch.groupe = enseigne; majEnseigne++; }

        apparies++; apparieDep++;
        maj.push({ id: p.id, patch });
      }

      if (!dryRun) {
        for (const m of maj) {
          const { error: e2 } = await admin.from('prospects').update(m.patch).eq('id', m.id);
          if (e2) throw e2;
        }
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
