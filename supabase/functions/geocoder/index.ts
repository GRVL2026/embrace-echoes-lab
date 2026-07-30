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

async function geocodeClients(): Promise<{ scanned: number; geocoded: number }> {
  const { data, error } = await admin
    .from('gaia_clients')
    .select('customer_id, adresse1, code_postal, ville, pays')
    .is('lat', null)
    .or('pays.is.null,pays.eq.,pays.ilike.FR%,pays.ilike.France%');
  if (error) throw error;

  const rows = (data || [])
    .map((r: any) => {
      const parts = [r.adresse1, r.code_postal, r.ville].map((s: any) => (s ?? '').toString().trim()).filter(Boolean);
      const adresse = parts.join(' ');
      return { id: String(r.customer_id), adresse };
    })
    .filter(r => r.adresse.length >= 5);

  let geocoded = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const map = await geocodeBatch(chunk);
    if (map.size === 0) continue;
    // Update en batch : on itère (pas d'upsert bulk facile ici)
    const updates = Array.from(map.entries()).map(([id, v]) =>
      admin.from('gaia_clients').update({ lat: v.lat, lng: v.lng, geocoded_at: new Date().toISOString() }).eq('customer_id', id)
    );
    await Promise.all(updates);
    geocoded += map.size;
  }
  return { scanned: rows.length, geocoded };
}

async function geocodeProspects(): Promise<{ scanned: number; geocoded: number }> {
  const { data, error } = await admin
    .from('prospects')
    .select('id, adresse, ville')
    .is('lat', null);
  if (error) throw error;

  const rows = (data || [])
    .map((r: any) => {
      const parts = [r.adresse, r.ville].map((s: any) => (s ?? '').toString().trim()).filter(Boolean);
      return { id: String(r.id), adresse: parts.join(' ') };
    })
    .filter(r => r.adresse.length >= 5);

  let geocoded = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const map = await geocodeBatch(chunk);
    if (map.size === 0) continue;
    const updates = Array.from(map.entries()).map(([id, v]) =>
      admin.from('prospects').update({ lat: v.lat, lng: v.lng, geocoded_at: new Date().toISOString() }).eq('id', id)
    );
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
    const prospects = await geocodeProspects();
    return new Response(JSON.stringify({ ok: true, clients, prospects }), {
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
