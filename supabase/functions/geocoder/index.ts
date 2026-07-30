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
const MAX_NOMINATIM_PER_RUN = 100;
// Pays couverts par la BAN : France métropolitaine + DOM
const BAN_COUNTRIES = ['FR', 'RE', 'GP', 'MQ', 'GF', 'YT'];
const NOMINATIM_UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)';

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
    if (id && isFinite(lat) && isFinite(lng) && score >= MIN_SCORE) {
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

async function geocodeClients(): Promise<{ scanned: number; geocoded: number }> {
  const { data, error } = await admin
    .from('gaia_clients')
    .select('customer_id, adresse1, code_postal, ville, pays, geocode_attempts')
    .is('lat', null)
    .lt('geocode_attempts', MAX_ATTEMPTS)
    .or(banFilter());
  if (error) throw error;

  const attempts = new Map<string, number>();
  const rows = (data || [])
    .map((r: any) => {
      const parts = [r.adresse1, r.code_postal, r.ville].map((s: any) => (s ?? '').toString().trim()).filter(Boolean);
      const adresse = parts.join(' ');
      attempts.set(String(r.customer_id), Number(r.geocode_attempts) || 0);
      return { id: String(r.customer_id), adresse };
    })
    .filter(r => r.adresse.length >= 5);

  let geocoded = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const map = await geocodeBatch(chunk);
    const now = new Date().toISOString();
    // Update en batch : on itère (pas d'upsert bulk facile ici)
    const updates = chunk.map(r => {
      const v = map.get(r.id);
      return v
        ? admin.from('gaia_clients').update({ lat: v.lat, lng: v.lng, geocoded_at: now, geocode_source: 'ban' }).eq('customer_id', r.id)
        : admin.from('gaia_clients').update({ geocode_attempts: (attempts.get(r.id) ?? 0) + 1, geocode_last_attempt: now }).eq('customer_id', r.id);
    });
    await Promise.all(updates);
    geocoded += map.size;
  }
  return { scanned: rows.length, geocoded };
}

// ---- Branche étrangère : Nominatim, granularité ville, cache geo_cache ----

function jitter(customerId: string): { dLat: number; dLng: number; lat0: number } {
  // hash déterministe -> angle + rayon (100 à 300 m)
  let h = 2166136261;
  for (let i = 0; i < customerId.length; i++) {
    h ^= customerId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = (Math.abs(h) % 3600) / 3600 * Math.PI * 2;
  const r = 100 + (Math.abs(Math.imul(h, 2654435761)) % 201); // 100..300 m
  return { dLat: (r * Math.cos(a)) / 111320, dLng: (r * Math.sin(a)) / 111320, lat0: 0 };
}

function applyJitter(lat: number, lng: number, customerId: string): { lat: number; lng: number } {
  const { dLat, dLng } = jitter(customerId);
  const cos = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng / cos };
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

async function geocodeClientsEtranger(): Promise<{ paires_traitees: number; geocodes: number; depuis_cache: number; restant: number }> {
  const { data, error } = await admin
    .from('gaia_clients')
    .select('customer_id, ville, pays, geocode_attempts')
    .is('lat', null)
    .lt('geocode_attempts', MAX_ATTEMPTS)
    .not('pays', 'is', null);
  if (error) throw error;

  // Regroupement par (ville, pays), hors pays couverts par la BAN
  const groups = new Map<string, { ville: string; pays: string; clients: { id: string; attempts: number }[] }>();
  for (const r of (data || []) as any[]) {
    const ville = (r.ville ?? '').toString().trim();
    const pays = (r.pays ?? '').toString().trim();
    if (!ville || pays.length !== 2) continue;
    const vNorm = ville.toUpperCase();
    const pNorm = pays.toUpperCase();
    if (BAN_COUNTRIES.includes(pNorm)) continue;
    const key = `${vNorm}|${pNorm}`;
    const g = groups.get(key) || { ville: vNorm, pays: pNorm, clients: [] };
    g.clients.push({ id: String(r.customer_id), attempts: Number(r.geocode_attempts) || 0 });
    groups.set(key, g);
  }

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

    const updates = g.clients.map(c => {
      if (coord) {
        const p = applyJitter(coord.lat, coord.lng, c.id);
        return admin.from('gaia_clients')
          .update({ lat: p.lat, lng: p.lng, geocoded_at: now, geocode_source: 'ville' })
          .eq('customer_id', c.id);
      }
      return admin.from('gaia_clients')
        .update({ geocode_attempts: c.attempts + 1, geocode_last_attempt: now })
        .eq('customer_id', c.id);
    });
    await Promise.all(updates);
    if (coord) geocodes += g.clients.length;
  }

  return { paires_traitees, geocodes, depuis_cache, restant };
}

async function geocodeProspects(): Promise<{ scanned: number; geocoded: number }> {
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
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const map = await geocodeBatch(chunk);
    const now = new Date().toISOString();
    const updates = chunk.map(r => {
      const v = map.get(r.id);
      return v
        ? admin.from('prospects').update({ lat: v.lat, lng: v.lng, geocoded_at: now, geocode_source: 'ban' }).eq('id', r.id)
        : admin.from('prospects').update({ geocode_attempts: (attempts.get(r.id) ?? 0) + 1, geocode_last_attempt: now }).eq('id', r.id);
    });
    await Promise.all(updates);
    geocoded += map.size;
  }
  return { scanned: rows.length, geocoded };
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
