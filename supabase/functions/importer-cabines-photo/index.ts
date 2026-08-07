import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { departementDepuisCP, regionDepuisCP } from '../_shared/territoire.ts';

// Cabines photo installées en France, relevées chez un concurrent.
//
// Trois cent trente et un lieux qui ont déjà accepté une cabine — l'objection de
// principe est derrière eux. Leur profil est d'ailleurs instructif : ni bowlings ni
// cinémas, mais des bars urbains, des centres commerciaux et des chaînes de
// restauration. Le marché de la cabine photo n'est pas celui de l'arcade.
//
// Le site n'interdit rien dans son robots.txt, et une seule page contient tout : une
// requête suffit, il n'y a pas de rythme à ménager.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const SOURCE = 'https://tabobine.com/trouver-une-cabine-photo';
const UA = 'Mozilla/5.0 (compatible; ArcadeOS/1.0; +https://avranchesautomatic.com)';
const BUDGET_MS = 110_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&rsquo;/g, "'").replace(/&[a-z]{2,8};/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Le concurrent n'est pas qu'en France : Belgique, Italie, Luxembourg. Un code postal
// belge fait quatre chiffres, un italien cinq comme le nôtre — se fier au seul format
// rangerait Brescia dans le Doubs. Le nom du pays, quand il est écrit, fait donc foi.
const PAYS: { motif: RegExp; code: string }[] = [
  { motif: /\bbelgi(que|e|um)\b|\bantwerpen\b|\bbruxelles\b/i, code: 'BE' },
  { motif: /\bitali[ae]\b|\bbrescia\b|\bmilano\b/i, code: 'IT' },
  { motif: /\bluxembourg\b/i, code: 'LU' },
  { motif: /\bsuisse\b|\bschweiz\b/i, code: 'CH' },
  { motif: /\bespa(gne|ña)\b/i, code: 'ES' },
];

/** Découpe « 3 Av. de Paris, 78000 Versailles » en rue, code postal et ville. La
 *  ponctuation varie d'une entrée à l'autre — virgule, tiret, rien — on s'appuie donc
 *  sur le code postal, seul élément dont la forme soit certaine. Quand il manque, on
 *  retient le dernier fragment comme ville : « 30 Quai Virginie Hériot, Bordeaux »
 *  reste exploitable, alors qu'un rejet pur perdrait dix-huit lieux sur trois cents. */
function decouper(adresse: string): {
  rue: string | null; cp: string | null; ville: string | null; pays: string;
} {
  const pays = PAYS.find((p) => p.motif.test(adresse))?.code ?? 'FR';
  const sansPays = adresse.replace(/,?\s*(France|Belgique|Belgium|Italie|Italia|Luxembourg|Suisse|Espagne|España)\s*$/i, '').trim();

  const m = sansPays.match(/^(.*?)[\s,–-]*\b(\d{5})\b[\s,]*(.*)$/);
  if (m) {
    return {
      rue: m[1].replace(/[\s,–-]+$/, '').trim() || null,
      cp: m[2],
      ville: m[3].replace(/^[\s,–-]+/, '').trim() || null,
      pays,
    };
  }
  const morceaux = sansPays.split(/\s*,\s*/).filter(Boolean);
  if (morceaux.length >= 2) {
    return { rue: morceaux.slice(0, -1).join(', ') || null, cp: null,
             ville: morceaux[morceaux.length - 1] || null, pays };
  }
  return { rue: sansPays || null, cp: null, ville: null, pays };
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

    // ── Géocodage, par lots ───────────────────────────────────────────────────
    // L'API adresse du gouvernement traite un fichier CSV entier en une requête. Pour
    // trois cents lignes c'est instantané et gratuit, là où une requête par adresse
    // prendrait cinq minutes et se ferait limiter.
    if (body.action === 'geocoder') {
      const { data: aFaire, error } = await admin.from('cabines_photo')
        .select('id, adresse, code_postal, ville')
        .is('geocode_at', null).eq('pays', 'FR').limit(200);   // l'API adresse ne couvre que la France
      if (error) throw error;
      if (!aFaire?.length) return json({ ok: true, geocodees: 0, termine: true });

      const csv = 'id,adresse,codepostal\n' + aFaire.map((c: any) =>
        `${c.id},"${String(c.adresse ?? c.ville ?? '').replace(/"/g, "'")}","${c.code_postal ?? ''}"`).join('\n');
      const form = new FormData();
      form.append('data', new Blob([csv], { type: 'text/csv' }), 'a.csv');
      form.append('columns', 'adresse');
      form.append('postcode', 'codepostal');

      const res = await fetch('https://api-adresse.data.gouv.fr/search/csv/', { method: 'POST', body: form });
      if (!res.ok) { res.body?.cancel(); return json({ error: `API adresse HTTP ${res.status}` }, 502); }
      const rendu = await res.text();
      const lignes = rendu.split('\n').filter(Boolean);
      const entete = lignes[0].split(',');
      const iLat = entete.indexOf('latitude'), iLng = entete.indexOf('longitude'),
            iScore = entete.indexOf('result_score');

      let ok = 0;
      for (const l of lignes.slice(1)) {
        const c = l.split(',');
        const id = c[0];
        const lat = Number(c[iLat]), lng = Number(c[iLng]), score = Number(c[iScore]);
        // Un score faible signale une adresse mal comprise : on horodate quand même
        // pour ne pas boucler, mais on ne place pas le point sur la carte.
        const fiable = Number.isFinite(lat) && Number.isFinite(lng) && score >= 0.4;
        const { error: e } = await admin.from('cabines_photo').update({
          lat: fiable ? lat : null, lng: fiable ? lng : null,
          geocode_score: Number.isFinite(score) ? score : null,
          geocode_at: new Date().toISOString(),
        }).eq('id', id);
        if (e) throw e;
        if (fiable) ok++;
      }
      const { count } = await admin.from('cabines_photo')
        .select('id', { count: 'exact', head: true }).is('geocode_at', null);
      return json({ ok: true, traitees: lignes.length - 1, placees: ok, restantes: count ?? 0 });
    }

    // ── Relevé de la page ─────────────────────────────────────────────────────
    const res = await fetch(SOURCE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { res.body?.cancel(); return json({ error: `HTTP ${res.status} sur la source` }, 502); }
    const page = await res.text();

    const lignes: any[] = [];
    for (const m of page.matchAll(/<address>\s*<div class="ti">([\s\S]*?)<\/div>([\s\S]*?)<\/address>/g)) {
      const nom = decode(m[1]);
      const brut = decode(m[2]);
      if (!nom || nom.length < 2) continue;
      const { rue, cp, ville, pays } = decouper(brut);
      lignes.push({
        exploitant: 'Tabobine', nom,
        adresse: rue, code_postal: cp, ville, pays,
        // Département et région n'ont de sens qu'en France : un code postal italien
        // a cinq chiffres lui aussi, et Brescia se retrouverait dans le Doubs.
        departement: pays === 'FR' ? departementDepuisCP(cp) : null,
        region: pays === 'FR' ? regionDepuisCP(cp) : null,
        releve_le: new Date().toISOString(),
      });
    }
    if (lignes.length === 0) return json({ error: 'Aucune adresse trouvée — la page a changé de structure' }, 502);

    if (body.dry_run === true) {
      return json({ ok: true, mode: 'analyse', trouvees: lignes.length,
        apercu: lignes.slice(0, 8).map((l) => `${l.nom} · ${l.ville ?? '?'} (${l.departement ?? '?'})`) });
    }

    for (let i = 0; i < lignes.length; i += 200) {
      if (Date.now() - debut > BUDGET_MS) break;
      const { error } = await admin.from('cabines_photo')
        .upsert(lignes.slice(i, i + 200), { onConflict: 'exploitant,nom,adresse', ignoreDuplicates: false });
      if (error) throw error;
      await dormir(50);
    }

    const { count } = await admin.from('cabines_photo').select('id', { count: 'exact', head: true });
    return json({ ok: true, relevees: lignes.length, en_base: count ?? 0,
      sans_code_postal: lignes.filter((l) => !l.code_postal).length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
