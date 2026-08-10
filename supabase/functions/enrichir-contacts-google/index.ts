import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { cle, cleIdentifiante, metres, similarite } from '../_shared/rapprochement.ts';

// Téléphone et site web via Google Places.
//
// Le manque est concentré : six mille cinq cents petits campings sans aucune présence
// web, qu'OpenStreetMap ne connaît pas et dont le site n'existe pas. Google, lui, les
// répertorie tous.
//
// DEUX GARDE-FOUS, et ils ne protègent pas Google mais la base.
//
// 1. ON NE PREND JAMAIS LE PREMIER RÉSULTAT SANS LE VÉRIFIER. Une recherche textuelle
//    rend toujours quelque chose : demandez « Camping du Lac » près de Périgueux et
//    Google proposera volontiers un camping à trente kilomètres, ou une supérette. Le
//    nom doit concorder ET le lieu doit être proche. Un mauvais numéro dans une fiche
//    est pire que pas de numéro : le commercial appelle, dérange un inconnu, et perd
//    confiance dans l'outil entier.
//
// 2. CHAQUE REQUÊTE EST FACTURÉE. On horodate donc toute tentative, aboutie ou non, et
//    on ne redemande jamais deux fois la même chose. Le `place_id` est conservé : c'est
//    la seule donnée que les conditions de Places autorisent à garder sans limite, et
//    elle évite de repayer une recherche pour retrouver le même établissement.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const GOOGLE_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const PLACES = 'https://places.googleapis.com/v1/places:searchText';

// On ne demande QUE les champs utilisés. Le masque de champs détermine la facturation :
// réclamer des horaires ou des avis dont on ne fait rien coûterait plus cher pour rien.
const CHAMPS = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.location',
].join(',');

const LOT = 40;
const PARALLELE = 4;          // rester sous les quotas de débit de l'API
const BUDGET_MS = 110_000;
const RAYON_BIAIS = 8_000;    // on cherche autour de l'adresse connue, pas dans toute la France
const D_MAX = 1_200;          // au-delà, ce n'est plus le même établissement
const SIM_MIN = 0.42;         // « Camping Le Pech » contre « Camping du Pech de Caumont » passe

type Fiche = {
  id: string; entreprise: string; ville: string | null; code_postal: string | null;
  adresse: string | null; lat: number | null; lng: number | null;
  telephone: string | null; site_web: string | null;
};

type Trouvaille = {
  place_id: string; nom: string; tel: string | null; site: string | null;
  d: number | null; sim: number;
};

/** Le numéro national français, ramené à une forme unique. Google rend « 05 53 28 33 33 »
 *  ou « +33 5 53 28 33 33 » selon les fiches. */
function normaliserTel(brut: string | null): string | null {
  if (!brut) return null;
  const chiffres = brut.replace(/[^\d+]/g, '').replace(/^\+33/, '0');
  return /^0[1-9]\d{8}$/.test(chiffres) ? chiffres : null;
}

async function chercher(f: Fiche): Promise<Trouvaille | null> {
  // La requête reprend le nom ET la commune : « Camping du Lac » seul est ambigu dans
  // toute la France, avec la commune il ne l'est presque plus.
  const requete = [f.entreprise, f.code_postal, f.ville].filter(Boolean).join(' ');
  const corps: Record<string, unknown> = { textQuery: requete, languageCode: 'fr', maxResultCount: 5 };
  if (f.lat != null && f.lng != null) {
    corps.locationBias = {
      circle: { center: { latitude: f.lat, longitude: f.lng }, radius: RAYON_BIAIS },
    };
  }

  const res = await fetch(PLACES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': CHAMPS,
    },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Places HTTP ${res.status} — ${detail}`);
  }
  const data = await res.json();
  const lieux = (data.places ?? []) as any[];
  if (!lieux.length) return null;

  // On note chaque candidat sur le nom et la distance, et on retient le meilleur — à
  // condition qu'il franchisse les deux seuils. Aucun candidat acceptable vaut mieux
  // qu'un candidat approximatif.
  const cleFiche = cleIdentifiante(f.entreprise);
  const bruteFiche = cle(f.entreprise);
  let meilleur: Trouvaille | null = null;

  for (const l of lieux) {
    const nom = String(l.displayName?.text ?? '');
    if (!nom) continue;
    const sim = Math.max(
      similarite(cleFiche, cleIdentifiante(nom)),
      similarite(bruteFiche, cle(nom)),
    );
    const d = (f.lat != null && f.lng != null && l.location)
      ? metres(f.lat, f.lng, l.location.latitude, l.location.longitude)
      : null;

    if (sim < SIM_MIN) continue;
    if (d !== null && d > D_MAX) continue;

    const candidat: Trouvaille = {
      place_id: String(l.id ?? ''), nom,
      tel: normaliserTel(l.nationalPhoneNumber ?? null),
      site: l.websiteUri ? String(l.websiteUri) : null,
      d, sim,
    };
    if (!meilleur || sim > meilleur.sim) meilleur = candidat;
  }
  return meilleur;
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

  if (!GOOGLE_KEY) return json({ error: 'GOOGLE_MAPS_API_KEY absente des secrets' }, 500);

  const debut = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const lot = Math.min(120, Math.max(1, Number(body.lot ?? LOT)));
    const dryRun = body.dry_run === true;
    const segments: string[] = Array.isArray(body.segments) && body.segments.length
      ? body.segments.map((s: unknown) => String(s))
      : ['camping', 'loisirs', 'chr', 'retail', 'fec', 'autre'];

    let q = admin.from('prospects')
      .select('id, entreprise, ville, code_postal, adresse, lat, lng, telephone, site_web')
      .in('segment', segments)
      .is('google_tente_at', null)
      .eq('joignable', false)          // on ne paie pas pour ce qu'on a déjà
      .limit(lot);
    if (body.source) q = q.eq('source', String(body.source));

    // Ciblage géographique. Le quota gratuit est mensuel et limité : mieux vaut le
    // dépenser sur une zone cohérente, qui donnera de vraies tournées, que le disperser
    // sur toute la France en points isolés qu'aucun commercial ne pourra enchaîner.
    if (Array.isArray(body.departements) && body.departements.length) {
      q = q.in('departement', body.departements.map((d: unknown) => String(d)));
    }
    const { data: brutes, error } = await q;
    if (error) throw error;
    if (!brutes?.length) return json({ ok: true, interroges: 0, termine: true });

    const fiches = brutes as Fiche[];
    const resultats: { f: Fiche; t: Trouvaille | null }[] = [];
    let erreurs = 0, derniereErreur = '';

    let curseur = 0;
    const travailleur = async () => {
      while (curseur < fiches.length && Date.now() - debut < BUDGET_MS) {
        const f = fiches[curseur++];
        try {
          resultats.push({ f, t: await chercher(f) });
        } catch (e) {
          erreurs++;
          derniereErreur = String((e as Error).message).slice(0, 160);
          resultats.push({ f, t: null });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLELE, fiches.length) }, travailleur));

    // Une clé refusée ou un quota dépassé se voit tout de suite : tout échoue. Inutile
    // d'horodater dans ce cas — on rendrait les fiches inatteignables pour rien.
    if (erreurs === resultats.length && erreurs > 0) {
      return json({ error: `Toutes les requêtes ont échoué — ${derniereErreur}` }, 502);
    }

    let tels = 0, sites = 0, apparies = 0;
    if (!dryRun) {
      const maintenant = new Date().toISOString();
      for (const { f, t } of resultats) {
        const patch: Record<string, unknown> = { google_tente_at: maintenant };
        if (t) {
          patch.google_place_id = t.place_id;
          if (t.tel && !f.telephone) { patch.telephone = t.tel; tels++; }
          if (t.site && !f.site_web) { patch.site_web = t.site; sites++; }
          apparies++;
        }
        const { error: e2 } = await admin.from('prospects').update(patch).eq('id', f.id);
        if (e2) throw e2;
      }
    } else {
      for (const { f, t } of resultats) {
        if (!t) continue;
        apparies++;
        if (t.tel && !f.telephone) tels++;
        if (t.site && !f.site_web) sites++;
      }
    }

    // Le décompte doit porter EXACTEMENT sur le même périmètre que la sélection, filtre
    // géographique compris : sinon la boucle appelante croit qu'il reste du travail
    // ailleurs et relance indéfiniment sur un lot déjà vide — en payant à chaque tour.
    let qr = admin.from('prospects')
      .select('id', { count: 'exact', head: true })
      .in('segment', segments).is('google_tente_at', null).eq('joignable', false);
    if (body.source) qr = qr.eq('source', String(body.source));
    if (Array.isArray(body.departements) && body.departements.length) {
      qr = qr.in('departement', body.departements.map((d: unknown) => String(d)));
    }
    const { count: restants } = await qr;

    return json({
      ok: true, mode: dryRun ? 'analyse' : 'écriture',
      interroges: resultats.length, apparies,
      telephones: tels, sites: sites,
      sans_correspondance: resultats.length - apparies,
      erreurs, derniere_erreur: erreurs ? derniereErreur : undefined,
      restants: restants ?? 0,
      apercu: resultats.filter((r) => r.t).slice(0, 10).map((r) =>
        `${r.f.entreprise} ↔ ${r.t!.nom}`
        + ` (${r.t!.d !== null ? `${Math.round(r.t!.d)} m` : 'sans position'}, ${Math.round(r.t!.sim * 100)} %)`
        + ` · ${[r.t!.tel ? 'tél' : null, r.t!.site ? 'site' : null].filter(Boolean).join(' ') || 'rien'}`),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
