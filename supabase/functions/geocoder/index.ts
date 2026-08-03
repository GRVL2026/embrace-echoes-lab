import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Géocode les clients FR et les prospects via api-adresse.data.gouv.fr (batch CSV).
// Ne re-géocode jamais une ligne avec lat/lng déjà présents.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const BATCH_SIZE = 500; // limite raisonnable pour l'API BAN
const MIN_SCORE = 0.3;
const MAX_ATTEMPTS = 3;
const MAX_NOMINATIM_PER_RUN = 60;
// Micro-territoires : aucun décalage (le point sortirait du pays ou en mer)
const MICRO_TERRITOIRES = ['LU', 'MT', 'SM', 'HK', 'MO', 'SG', 'GG'];
// Pays couverts par la BAN : France métropolitaine + DOM
const BAN_COUNTRIES = ['FR', 'RE', 'GP', 'MQ', 'GF', 'YT'];
const NOMINATIM_UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)';

// --- Contrôle de cohérence code postal <-> coordonnées ---
// La BAN renvoie parfois un point à l'autre bout du monde (constaté : LE MANS placé en
// Guadeloupe, MONACO 98000 confondu avec les 988xx de Nouvelle-Calédonie). Un simple cadre
// « France métropolitaine » ne suffit pas : il rejetterait les DOM-COM, correctement placés.
// On compare donc le point obtenu à la zone attendue d'après le code postal.
type Box = [latMin: number, latMax: number, lngMin: number, lngMax: number];

const BOX_METROPOLE: Box = [41.3, 51.2, -5.2, 9.6];

const ZONES_FR: Array<{ nom: string; prefixe: (cp: string) => boolean; box: Box }> = [
  // ⚠️ 970xx/971xx couvrent la Guadeloupe MAIS AUSSI Saint-Martin (97150, CEDEX 97071) et
  // Saint-Barthélemy (97133). Les codes 977/978 sont des codes INSEE, pas des codes postaux :
  // les utiliser ici rejetterait à tort des clients correctement géocodés (cas vérifié en base).
  // D'où une zone unique, volontairement large, pour les Antilles françaises du Nord.
  { nom: 'Guadeloupe / Saint-Martin / Saint-Barthélemy', prefixe: cp => cp.startsWith('970') || cp.startsWith('971'), box: [15.8, 18.2, -63.2, -60.9] },
  { nom: 'Martinique', prefixe: cp => cp.startsWith('972'), box: [14.3, 15.0, -61.3, -60.7] },
  { nom: 'Guyane', prefixe: cp => cp.startsWith('973'), box: [2.0, 6.0, -55.0, -51.5] },
  { nom: 'La Réunion', prefixe: cp => cp.startsWith('974'), box: [-21.5, -20.8, 55.1, 55.9] },
  { nom: 'Saint-Pierre-et-Miquelon', prefixe: cp => cp.startsWith('975'), box: [46.7, 47.2, -56.5, -56.1] },
  { nom: 'Mayotte', prefixe: cp => cp.startsWith('976'), box: [-13.1, -12.6, 45.0, 45.3] },
  { nom: 'Monaco', prefixe: cp => cp === '98000', box: [43.7, 43.8, 7.3, 7.5] },
  { nom: 'Wallis-et-Futuna', prefixe: cp => cp.startsWith('986'), box: [-14.4, -13.2, -178.2, -176.1] },
  { nom: 'Polynésie française', prefixe: cp => cp.startsWith('987'), box: [-28.0, -7.0, -155.0, -134.0] },
  { nom: 'Nouvelle-Calédonie', prefixe: cp => cp.startsWith('988'), box: [-22.8, -19.5, 163.5, 168.2] },
];

function dansBox(lat: number, lng: number, [latMin, latMax, lngMin, lngMax]: Box): boolean {
  return lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax;
}

// Coordonnées manifestement inutilisables, quel que soit le pays.
function coordAberrante(lat: number, lng: number): boolean {
  if (!isFinite(lat) || !isFinite(lng)) return true;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return true;
  if (lat === 0 && lng === 0) return true; // « point zéro » au large du golfe de Guinée
  return false;
}

// Vérifie qu'un point français tombe bien dans la zone attendue par son code postal.
// Sans code postal exploitable, on se contente d'exiger une zone française quelconque.
function coordCoherente(lat: number, lng: number, codePostal: string): { ok: boolean; zone: string } {
  if (coordAberrante(lat, lng)) return { ok: false, zone: 'coordonnée aberrante' };
  const cp = (codePostal ?? '').replace(/\D/g, '');
  if (cp.length >= 5) {
    const zone = ZONES_FR.find(z => z.prefixe(cp));
    if (zone) return { ok: dansBox(lat, lng, zone.box), zone: zone.nom };
    return { ok: dansBox(lat, lng, BOX_METROPOLE), zone: 'France métropolitaine' };
  }
  const ok = dansBox(lat, lng, BOX_METROPOLE) || ZONES_FR.some(z => dansBox(lat, lng, z.box));
  return { ok, zone: 'territoire français (code postal absent)' };
}

function csvEscape(s: string): string {
  const v = (s ?? '').replace(/"/g, '""');
  return `"${v}"`;
}

async function geocodeBatch(rows: Array<{ id: string; adresse: string }>): Promise<Map<string, { lat: number; lng: number; score: number }>> {
  const out = new Map<string, { lat: number; lng: number; score: number }>();
  if (rows.length === 0) return out;

  const header = 'id,adresse\n';
  const body = rows.map(r => `${csvEscape(r.id)},${csvEscape(r.adresse)}`).join('\n');
  const csv = header + body;

  const fd = new FormData();
  fd.append('data', new Blob([csv], { type: 'text/csv' }), 'input.csv');
  fd.append('columns', 'adresse');
  fd.append('result_columns', 'result_score');
  fd.append('result_columns', 'latitude');
  fd.append('result_columns', 'longitude');

  const res = await fetch('https://api-adresse.data.gouv.fr/search/csv/', { method: 'POST', body: fd });
  if (!res.ok) {
    console.error('BAN batch failed', res.status, await res.text().catch(() => ''));
    return out;
  }
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return out;
  const cols = lines[0].split(',');
  const iId = cols.indexOf('id');
  const iLat = cols.indexOf('latitude');
  const iLng = cols.indexOf('longitude');
  const iScore = cols.indexOf('result_score');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // parse CSV simple (les valeurs id/lat/lng ne contiennent pas de virgules à ce stade car BAN les préfixe)
    const parts = parseCsvLine(line);
    const id = parts[iId];
    const lat = parseFloat(parts[iLat] || '');
    const lng = parseFloat(parts[iLng] || '');
    const score = parseFloat(parts[iScore] || '0');
    if (id && !coordAberrante(lat, lng) && score >= MIN_SCORE) {
      out.set(id, { lat, lng, score });
    }
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function banFilter(): string {
  const parts = ['pays.is.null', 'pays.eq.'];
  for (const c of BAN_COUNTRIES) parts.push(`pays.ilike.${c}%`);
  parts.push('pays.ilike.France%');
  return parts.join(',');
}

async function geocodeClients(): Promise<{ scanned: number; geocoded: number; rejetes_incoherents: number }> {
  const { data, error } = await admin
    .from('gaia_clients')
    .select('customer_id, adresse1, code_postal, ville, pays, geocode_attempts')
    .is('lat', null)
    .lt('geocode_attempts', MAX_ATTEMPTS)
    .or(banFilter());
  if (error) throw error;

  const attempts = new Map<string, number>();
  const codesPostaux = new Map<string, string>();
  const rows = (data || [])
    .map((r: any) => {
      const parts = [r.adresse1, r.code_postal, r.ville].map((s: any) => (s ?? '').toString().trim()).filter(Boolean);
      const adresse = parts.join(' ');
      attempts.set(String(r.customer_id), Number(r.geocode_attempts) || 0);
      codesPostaux.set(String(r.customer_id), (r.code_postal ?? '').toString());
      return { id: String(r.customer_id), adresse };
    })
    .filter(r => r.adresse.length >= 5);

  let geocoded = 0;
  let rejetes = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const map = await geocodeBatch(chunk);
    const now = new Date().toISOString();
    // Update en batch : on itère (pas d'upsert bulk facile ici)
    const updates = chunk.map(r => {
      const v = map.get(r.id);
      const echec = () => admin.from('gaia_clients')
        .update({ geocode_attempts: (attempts.get(r.id) ?? 0) + 1, geocode_last_attempt: now })
        .eq('customer_id', r.id);
      if (!v) return echec();
      // Garde-fou : ne jamais écrire un point incohérent avec le code postal.
      const { ok, zone } = coordCoherente(v.lat, v.lng, codesPostaux.get(r.id) ?? '');
      if (!ok) {
        rejetes++;
        console.warn(`Coordonnées incohérentes ignorées — client ${r.id} : ${v.lat},${v.lng} hors ${zone} (CP « ${codesPostaux.get(r.id) ?? ''} », adresse « ${r.adresse} »)`);
        return echec();
      }
      geocoded++;
      return admin.from('gaia_clients')
        .update({ lat: v.lat, lng: v.lng, geocoded_at: now, geocode_source: 'ban' })
        .eq('customer_id', r.id);
    });
    await Promise.all(updates);
  }
  return { scanned: rows.length, geocoded, rejetes_incoherents: rejetes };
}

// ---- Branche étrangère : Nominatim, granularité ville, cache geo_cache ----

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

function jitter(customerId: string, minM = 100, maxM = 300): { dLat: number; dLng: number } {
  const h = hash32(customerId);
  const a = (Math.abs(h) % 3600) / 3600 * Math.PI * 2;
  const span = Math.max(1, maxM - minM + 1);
  const r = minM + (Math.abs(Math.imul(h, 2654435761)) % span);
  return { dLat: (r * Math.cos(a)) / 111320, dLng: (r * Math.sin(a)) / 111320 };
}

function applyJitter(lat: number, lng: number, customerId: string, minM = 100, maxM = 300): { lat: number; lng: number } {
  const { dLat, dLng } = jitter(customerId, minM, maxM);
  const cos = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng / cos };
}

// Nettoyage des villes issues de Cegid avant appel Nominatim.
function nettoyerVille(ville: string): string | null {
  let v = (ville ?? '').toString();
  v = v.replace(/\([^)]*\)/g, ' ');            // (MI), (BS)...
  v = v.replace(/[^\p{L}\s'’-]+/gu, ' ');       // toute séquence contenant des chiffres / ponctuation
  v = v.replace(/[_]+/g, ' ');
  v = v.replace(/[\s'’-]{2,}/g, ' ');
  v = v.replace(/\s+/g, ' ').trim();
  v = v.replace(/^[-'’]+|[-'’]+$/g, '').trim();
  if (!v) return null;
  const lettres = v.match(/\p{L}/gu) || [];
  if (lettres.length < 3) return null;
  if (!/\p{L}{3,}/u.test(v)) return null;
  return v;
}

async function chargerCentroides(): Promise<Map<string, { lat: number; lng: number }>> {
  const m = new Map<string, { lat: number; lng: number }>();
  const { data, error } = await admin.from('geo_pays_centroide').select('pays, lat, lng');
  if (error) { console.error('geo_pays_centroide', error.message); return m; }
  for (const r of (data || []) as any[]) {
    const p = (r.pays ?? '').toString().trim().toUpperCase();
    if (p && r.lat != null && r.lng != null) m.set(p, { lat: Number(r.lat), lng: Number(r.lng) });
  }
  return m;
}

async function nominatimCity(ville: string, pays: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', ville);
  url.searchParams.set('countrycodes', pays.toLowerCase());
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'fr' },
  });
  if (!res.ok) {
    console.error('Nominatim failed', res.status, ville, pays);
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!Array.isArray(json) || json.length === 0) return null;
  const lat = parseFloat(json[0].lat);
  const lng = parseFloat(json[0].lon);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

async function geocodeClientsEtranger(): Promise<{
  paires_traitees: number; geocodes: number; depuis_cache: number; restant: number;
  repli_pays: { clients_places: number; pays_inconnus: string[] };
}> {
  const { data, error } = await admin
    .from('gaia_clients')
    .select('customer_id, ville, pays, geocode_attempts')
    .is('lat', null)
    .lt('geocode_attempts', MAX_ATTEMPTS)
    .not('pays', 'is', null);
  if (error) throw error;

  const centroides = await chargerCentroides();
  const paysInconnus = new Set<string>();
  let repliPlaces = 0;

  const now0 = new Date().toISOString();
  const replier = async (id: string, pays: string, attempts: number) => {
    const c = centroides.get(pays);
    if (!c) {
      paysInconnus.add(pays);
      await admin.from('gaia_clients')
        .update({ geocode_attempts: attempts + 1, geocode_last_attempt: now0 })
        .eq('customer_id', id);
      return;
    }
    const p = MICRO_TERRITOIRES.includes(pays)
      ? { lat: c.lat, lng: c.lng }
      : applyJitter(c.lat, c.lng, id, 3000, 10000);
    await admin.from('gaia_clients')
      .update({ lat: p.lat, lng: p.lng, geocoded_at: now0, geocode_source: 'pays' })
      .eq('customer_id', id);
    repliPlaces++;
  };

  // Regroupement par (ville nettoyée, pays), hors pays couverts par la BAN
  const groups = new Map<string, { ville: string; pays: string; clients: { id: string; attempts: number }[] }>();
  const sansVille: { id: string; pays: string; attempts: number }[] = [];

  for (const r of (data || []) as any[]) {
    const pays = (r.pays ?? '').toString().trim().toUpperCase();
    if (pays.length !== 2 || BAN_COUNTRIES.includes(pays)) continue;
    const id = String(r.customer_id);
    const attempts = Number(r.geocode_attempts) || 0;
    const ville = nettoyerVille((r.ville ?? '').toString());
    if (!ville) { sansVille.push({ id, pays, attempts }); continue; }
    const vNorm = ville.toUpperCase();
    const key = `${vNorm}|${pays}`;
    const g = groups.get(key) || { ville: vNorm, pays, clients: [] };
    g.clients.push({ id, attempts });
    groups.set(key, g);
  }

  // Villes inexploitables -> repli pays immédiat (aucun appel réseau)
  for (const c of sansVille) await replier(c.id, c.pays, c.attempts);

  let paires_traitees = 0;
  let geocodes = 0;
  let depuis_cache = 0;
  let calls = 0;
  let restant = 0;

  for (const g of groups.values()) {
    const { data: cached } = await admin
      .from('geo_cache')
      .select('lat, lng, found')
      .eq('ville_norm', g.ville)
      .eq('pays_norm', g.pays)
      .maybeSingle();

    let coord: { lat: number; lng: number } | null = null;
    let fromCache = false;

    if (cached) {
      fromCache = true;
      if (cached.found && cached.lat != null && cached.lng != null) {
        coord = { lat: Number(cached.lat), lng: Number(cached.lng) };
      }
    } else {
      if (calls >= MAX_NOMINATIM_PER_RUN) { restant++; continue; }
      if (calls > 0) await new Promise(r => setTimeout(r, 1100)); // 1 req/s max, séquentiel
      calls++;
      coord = await nominatimCity(g.ville, g.pays).catch(() => null);
      await admin.from('geo_cache').upsert({
        ville_norm: g.ville,
        pays_norm: g.pays,
        lat: coord?.lat ?? null,
        lng: coord?.lng ?? null,
        found: !!coord,
        source: 'nominatim',
      }, { onConflict: 'ville_norm,pays_norm' });
    }

    paires_traitees++;
    if (fromCache) depuis_cache++;
    const now = new Date().toISOString();

    if (coord) {
      const updates = g.clients.map(c => {
        const p = applyJitter(coord!.lat, coord!.lng, c.id);
        return admin.from('gaia_clients')
          .update({ lat: p.lat, lng: p.lng, geocoded_at: now, geocode_source: 'ville' })
          .eq('customer_id', c.id);
      });
      await Promise.all(updates);
      geocodes += g.clients.length;
    } else {
      // Nominatim (ou cache négatif) sans résultat -> repli pays
      for (const c of g.clients) await replier(c.id, c.pays, c.attempts);
    }
  }

  return {
    paires_traitees, geocodes, depuis_cache, restant,
    repli_pays: { clients_places: repliPlaces, pays_inconnus: [...paysInconnus].sort() },
  };
}

async function geocodeProspects(): Promise<{ scanned: number; geocoded: number; rejetes_incoherents: number }> {
  const { data, error } = await admin
    .from('prospects')
    .select('id, adresse, ville, geocode_attempts')
    .is('lat', null)
    .lt('geocode_attempts', MAX_ATTEMPTS);
  if (error) throw error;

  const attempts = new Map<string, number>();
  const rows = (data || [])
    .map((r: any) => {
      const parts = [r.adresse, r.ville].map((s: any) => (s ?? '').toString().trim()).filter(Boolean);
      attempts.set(String(r.id), Number(r.geocode_attempts) || 0);
      return { id: String(r.id), adresse: parts.join(' ') };
    })
    .filter(r => r.adresse.length >= 5);

  let geocoded = 0;
  let rejetes = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const map = await geocodeBatch(chunk);
    const now = new Date().toISOString();
    const updates = chunk.map(r => {
      const v = map.get(r.id);
      const echec = () => admin.from('prospects')
        .update({ geocode_attempts: (attempts.get(r.id) ?? 0) + 1, geocode_last_attempt: now })
        .eq('id', r.id);
      if (!v) return echec();
      // Les prospects n'ont pas de code postal : on exige au moins un territoire français.
      const { ok, zone } = coordCoherente(v.lat, v.lng, '');
      if (!ok) {
        rejetes++;
        console.warn(`Coordonnées incohérentes ignorées — prospect ${r.id} : ${v.lat},${v.lng} hors ${zone} (adresse « ${r.adresse} »)`);
        return echec();
      }
      geocoded++;
      return admin.from('prospects')
        .update({ lat: v.lat, lng: v.lng, geocoded_at: now, geocode_source: 'ban' })
        .eq('id', r.id);
    });
    await Promise.all(updates);
  }
  return { scanned: rows.length, geocoded, rejetes_incoherents: rejetes };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth : cron (header CRON_SECRET) OU admin/direction connecté
  const cronHdr = req.headers.get('x-cron-secret') || '';
  const isCron = CRON_SECRET && cronHdr === CRON_SECRET;

  if (!isCron) {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    const ok = (roles || []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    if (!ok) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const clients = await geocodeClients();
    const etranger = await geocodeClientsEtranger();
    const prospects = await geocodeProspects();
    return new Response(JSON.stringify({ ok: true, clients, etranger, prospects }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
