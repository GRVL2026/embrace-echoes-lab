import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { gouvBySiren, extractDirigeantPP } from '../_shared/gouv-entreprise.ts';
import { reservePappersCredits, getPappersUsage, PAPPERS_MONTHLY_CAP } from '../_shared/pappers-quota.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY') || '';

type Segment = 'loisirs' | 'chr' | 'retail';

// Ordre = priorité (loisirs > chr > retail)
const NAF_MAP: { code: string; segment: Segment; libelle: string }[] = [
  { code: '93.29Z', segment: 'loisirs', libelle: 'autres activités récréatives et de loisirs' },
  { code: '93.21Z', segment: 'loisirs', libelle: "parcs d'attractions et parcs à thèmes" },
  { code: '56.30Z', segment: 'chr',     libelle: 'débits de boissons' },
  { code: '55.30Z', segment: 'chr',     libelle: 'terrains de camping et parcs pour caravanes' },
  { code: '55.10Z', segment: 'chr',     libelle: 'hôtels et hébergement similaire' },
  { code: '47.65Z', segment: 'retail',  libelle: 'commerce de détail de jeux et jouets' },
];

const MAX_INSERT = 300;              // plafond par exécution (hebdomadaire)
const PER_PAGE = 50;
const MAX_PAGES_PER_NAF = 8;         // pagination : jusqu'à 400 résultats / NAF
const HARD_FLOOR_DAYS = 60;          // ne jamais remonter plus de 60 jours
const OVERLAP_DAYS = 1;              // recouvrement de sécurité
const API = 'https://api.pappers.fr/v2/recherche';
const LAST_RUN_KEY = 'signaux_last_run';                 // fallback global (legacy)
const lastRunKeyForNaf = (code: string) => `signaux_last_run:${code}`;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type FetchResult =
  | { ok: true; data: any }
  | { ok: false; status: number; body: string; message: string };

async function fetchWithRetry(url: string, tries = 2): Promise<FetchResult> {
  let lastStatus = 0;
  let lastBody = '';
  let lastMessage = 'unknown error';
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(to);
      lastStatus = r.status;
      if (r.status === 429 || r.status >= 500) {
        try { lastBody = (await r.text()).slice(0, 300); } catch { lastBody = ''; }
        lastMessage = `HTTP ${r.status}`;
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }
      if (r.status === 401 || r.status === 402 || r.status === 403) {
        try { lastBody = (await r.text()).slice(0, 300); } catch { lastBody = ''; }
        return {
          ok: false,
          status: r.status,
          body: lastBody,
          message: `Pappers: credits epuises ou cle invalide (HTTP ${r.status})`,
        };
      }
      if (!r.ok) {
        try { lastBody = (await r.text()).slice(0, 300); } catch { lastBody = ''; }
        return { ok: false, status: r.status, body: lastBody, message: `HTTP ${r.status}` };
      }
      try {
        const data = await r.json();
        return { ok: true, data };
      } catch (e) {
        return { ok: false, status: r.status, body: '', message: `invalid JSON: ${(e as Error).message}` };
      }
    } catch (e) {
      lastMessage = (e as Error).message || 'fetch failed';
      await new Promise((res) => setTimeout(res, 600));
    }
  }
  return { ok: false, status: lastStatus, body: lastBody, message: lastMessage };
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
  // Permission restreinte (défaut OFF, accordée compte par compte).
  const { data: perm } = await admin
    .from('user_menu_access')
    .select('allowed')
    .eq('user_id', uid)
    .eq('section_key', 'prospection.detecter_signaux')
    .maybeSingle();
  return perm?.allowed === true;
}

/**
 * Récupère le dirigeant personne physique via l'API gouv (gratuite).
 * Aucune clé requise, ~4 req/s en pratique.
 */
async function fetchDirigeant(siren: string): Promise<{ nom: string | null; role: string | null }> {
  try {
    const hit = await gouvBySiren(siren);
    if (!hit) return { nom: null, role: null };
    return extractDirigeantPP(hit);
  } catch {
    return { nom: null, role: null };
  }
}

async function loadConfig(admin: any, key: string): Promise<string | null> {
  const { data } = await admin.from('gaia_config').select('value').eq('key', key).maybeSingle();
  const v = (data as any)?.value;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}
async function saveConfig(admin: any, key: string, iso: string) {
  await admin.from('gaia_config').upsert({ key, value: iso }, { onConflict: 'key' });
}

/**
 * Fenêtre incrémentale : part de la dernière exécution RÉUSSIE (par code NAF),
 * avec recouvrement d'1 jour et plafond de sécurité à 60 jours.
 * Si une exécution échoue, la suivante rattrape la période manquée.
 */
function computeCutoff(lastRun: string | null, now: Date): string {
  const floor = new Date(now.getTime() - HARD_FLOOR_DAYS * 24 * 3600 * 1000);
  let cutoff = floor;
  if (lastRun) {
    const lr = new Date(lastRun + 'T00:00:00Z');
    lr.setUTCDate(lr.getUTCDate() - OVERLAP_DAYS);
    if (lr > cutoff) cutoff = lr;
  }
  return cutoff.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!(await isAuthorized(req))) return j(401, { error: 'Unauthorized' });
    if (!PAPPERS_API_KEY) return j(500, { error: 'PAPPERS_API_KEY manquant' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fenêtre incrémentale : max(dernier_run - 1 jour, aujourd'hui - 30 jours)
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hardFloor = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    let cutoff = hardFloor;
    const lastRun = await loadLastRun(admin);
    if (lastRun) {
      const lr = new Date(lastRun + 'T00:00:00Z');
      lr.setUTCDate(lr.getUTCDate() - 1); // recouvrement d'1 jour
      if (lr > cutoff) cutoff = lr;
    }
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Prospects déjà connus
    const { data: existing } = await admin
      .from('prospects')
      .select('siren, entreprise, ville')
      .not('siren', 'is', null);
    const knownSiren = new Set<string>();
    const knownPair = new Set<string>();
    for (const r of (existing || []) as any[]) {
      if (r.siren) knownSiren.add(String(r.siren).trim());
      if (r.entreprise && r.ville) knownPair.add(`${String(r.entreprise).toLowerCase().trim()}|${String(r.ville).toLowerCase().trim()}`);
    }

    const toInsert: any[] = [];
    const examples: string[] = [];
    const apiErrors: { naf: string; page: number; status: number; message: string; body?: string }[] = [];
    let scanned = 0;
    let napiOk = 0;
    let quotaHit = false;

    outer:
    for (const naf of NAF_MAP) {
      let nafHadSuccess = false;
      for (let page = 1; page <= MAX_PAGES_PER_NAF; page++) {
        if (toInsert.length >= MAX_INSERT) break outer;

        // Réserver 2 crédits Pappers avant l'appel /v2/recherche
        const quota = await reservePappersCredits(admin, 'recherche');
        if (!quota.ok) {
          quotaHit = true;
          apiErrors.push({ naf: naf.code, page, status: 0, message: `Plafond mensuel Pappers atteint (${quota.used}/${quota.cap})` });
          break outer;
        }

        const params = new URLSearchParams({
          api_token: PAPPERS_API_KEY,
          code_naf: naf.code,
          date_creation_min: cutoffStr,
          entreprise_cessee: 'false',
          precision: 'standard',
          par_page: String(PER_PAGE),
          page: String(page),
        });
        const url = `${API}?${params.toString()}`;
        const res = await fetchWithRetry(url);
        if (!res.ok) {
          apiErrors.push({
            naf: naf.code,
            page,
            status: res.status,
            message: res.message,
            body: res.body ? res.body.slice(0, 200) : undefined,
          });
          break; // NAF suivant
        }
        nafHadSuccess = true;
        const data = res.data;
        const results: any[] = Array.isArray(data.resultats) ? data.resultats : [];
        if (results.length === 0) break;

        for (const r of results) {
          scanned++;
          const dateCrea: string | null = r.date_creation || r.date_creation_formatee || null;
          if (!dateCrea) continue;
          if (dateCrea < cutoffStr) continue;

          const siren = String(r.siren || '').trim();
          if (!siren || knownSiren.has(siren)) continue;

          const nom = (r.nom_entreprise || r.denomination || r.nom_complet || '').toString().trim();
          const siege = r.siege || {};
          const ville = (siege.ville || r.ville || '').toString().trim();
          if (!nom) continue;

          const pairKey = `${nom.toLowerCase()}|${ville.toLowerCase()}`;
          if (knownPair.has(pairKey)) continue;

          // Dirigeant : gouv API (gratuit) — sleep 550ms pour rester sous ~2 req/s
          const finalDirig = await fetchDirigeant(siren);
          await new Promise((res) => setTimeout(res, 550));

          const signal =
            `Nouvel établissement — ${naf.libelle} (${naf.code}) créé le ${dateCrea}` +
            (ville ? ` à ${ville}` : '');

          const row: Record<string, any> = {
            entreprise: nom,
            ville: ville || null,
            siren,
            segment: naf.segment,
            source: 'signal',
            statut: 'nouveau',
            signal,
          };
          if (finalDirig.nom) row.contact_nom = finalDirig.nom;
          if (finalDirig.role) row.contact_role = finalDirig.role;

          toInsert.push(row);
          knownSiren.add(siren);
          knownPair.add(pairKey);
          if (examples.length < 5) examples.push(nom);

          if (toInsert.length >= MAX_INSERT) break outer;
        }
        // Page non pleine ⇒ plus rien à lire pour ce NAF
        if (results.length < PER_PAGE) break;
      }
      if (nafHadSuccess) napiOk++;
    }

    if (napiOk === 0 && apiErrors.length > 0 && !quotaHit) {
      const usedNow = await getPappersUsage(admin);
      return j(502, { error: 'Pappers injoignable', apiErrors, pappers_credits_used: usedNow, pappers_credits_cap: PAPPERS_MONTHLY_CAP });
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      let { data: ins, error: insErr } = await admin
        .from('prospects')
        .insert(toInsert)
        .select('id');
      if (insErr && /contact_(nom|role)/i.test(insErr.message)) {
        const stripped = toInsert.map(({ contact_nom, contact_role, ...rest }) => rest);
        const retry = await admin.from('prospects').insert(stripped).select('id');
        ins = retry.data; insErr = retry.error;
      }
      if (insErr) {
        const usedNow = await getPappersUsage(admin);
        return j(500, { error: `insert failed: ${insErr.message}`, scanned, apiErrors, napi_ok: napiOk, pappers_credits_used: usedNow, pappers_credits_cap: PAPPERS_MONTHLY_CAP });
      }
      inserted = ins?.length ?? 0;
    }

    // Marquer le run comme réussi seulement si au moins un NAF a répondu correctement
    if (napiOk > 0) await saveLastRun(admin, today);

    const usedNow = await getPappersUsage(admin);
    return j(200, {
      inserted,
      scanned,
      exemples: examples,
      apiErrors,
      napi_ok: napiOk,
      window_from: cutoffStr,
      window_to: today,
      pappers_credits_used: usedNow,
      pappers_credits_cap: PAPPERS_MONTHLY_CAP,
      quota_hit: quotaHit,
    });

  } catch (e) {
    return j(500, { error: (e as Error).message });
  }
});
