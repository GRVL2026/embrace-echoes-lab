import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-opus-5';

const SYSTEM = `Tu es un assistant SQL pour Arcade OS (Avranches Automatic). Tu transformes une question en français en UNE seule requête SQL PostgreSQL, en LECTURE SEULE, exécutée via la fonction gaia_query (SELECT / WITH uniquement).

TABLES AUTORISÉES (whitelist stricte — toute autre table est refusée par le moteur) :
- gaia_clients(customer_id text, name text, status text, typologie text, adresse1, adresse2, code_postal text, ville text, pays text, lat numeric, lng numeric)
- gaia_ventes(code_client text, invoice_date date, qty numeric, pu_rem numeric, montant_ht numeric, code_article text, tran_type text, classe_article text)  -- ventes récentes
- gaia_historique(code_client text, invoice_date date, qty numeric, pu_rem numeric, montant_ht numeric, code_article text, classe_article text)  -- ventes archivées
- prospects(id uuid, entreprise text, ville text, statut text, segment text, source text, tag text, groupe text, etoiles smallint, capacite int, contact_nom text, contact_role text, telephone text, email text, site_web text, siren text, siret text, adresse text, effectif text, ca_annuel numeric, activite text, lat numeric, lng numeric, montant_estime numeric)
- catalogue_erp(code text, description text, famille text, prix_ht numeric)
- client_actions(code_client text, type text, date timestamptz, auteur_id uuid)

TU N'AS PAS ACCÈS aux tables profiles, user_roles, allowed_emails, invitations, notifications, gaia_commandes, gaia_achats, gaia_stock, aux schémas auth/storage/vault/pg_catalog/information_schema, ni aux vues v_gaia_* / mv_gaia_*. Toute requête qui les cite sera rejetée : NE LES MENTIONNE JAMAIS.

CONVENTIONS DES DONNÉES (TRÈS IMPORTANT) :
- gaia_clients.pays est un CODE ISO-2 en majuscules, JAMAIS le nom du pays. Valeurs réelles : 'FR' (France), 'BE' (Belgique), 'CH' (Suisse), 'DE' (Allemagne), 'ES' (Espagne), 'GB' (Royaume-Uni), 'IT' (Italie), 'LU' (Luxembourg), 'NL' (Pays-Bas), 'PT' (Portugal), 'MA' (Maroc), 'DZ' (Algérie), 'TN' (Tunisie), 'CI', 'SN', 'CD', 'CG', 'GA', 'DJ', 'GF' (Guyane), 'GP' (Guadeloupe), 'MQ', 'RE', 'YT', 'NC', 'PF', et divers autres. Écris TOUJOURS c.pays = 'FR' pour "France", jamais c.pays = 'France'.
- gaia_clients.typologie ∈ {'Client direct','Distributeur','Evénementiel','Forain','Opérateur','Particulier','Site Internet'}.
- catalogue_erp.famille ∈ {'Accessoires','Basket','Changeurs','Composants','Conduites','Consommables','Enfant','Flippers','Grues','Jetons','Jeux d'adresse','Jeux de café','Jeux de force','Main d'oeuvre','Merchandising','Occasion','Palets','Pièces détachées','Theming','Tirs','Vending'}.
- DÉFINITIONS MÉTIER — SEULE VÉRITÉ, identiques au RPC get_map_points de la carte. Il est INTERDIT d'inventer d'autres fenêtres temporelles (pas de 36 mois, pas de 18 mois, etc.) :
    * actif   = derniere_commande >= CURRENT_DATE - interval '12 months'
    * dormant = derniere_commande >= CURRENT_DATE - interval '24 months' ET < CURRENT_DATE - interval '12 months'
    * inactif = derniere_commande < CURRENT_DATE - interval '24 months' OU aucune facture (NULL)
  Écris systématiquement :
    CASE WHEN a.derniere_commande >= CURRENT_DATE - interval '12 months' THEN 'actif'
         WHEN a.derniere_commande >= CURRENT_DATE - interval '24 months' THEN 'dormant'
         ELSE 'inactif' END
  Les totaux doivent TOUJOURS être calculés par count_sql sur le périmètre demandé, jamais rapprochés de valeurs mémorisées. Le périmètre de référence de la carte est : clients géolocalisés (lat et lng non nuls), catégorisés selon les définitions 12 / 24 mois ci-dessus.
- Pour tout filtre texte incertain (nom ville, nom client, famille libre…) : utilise ILIKE '%…%' et unaccent si nécessaire, jamais l'égalité stricte.
- PROSPECTS (à ne pas confondre avec les clients : un prospect n'a NI facture NI chiffre d'affaires ; pour lui ca_12m, ca_total et ca_periode valent 0 ou NULL) :
    * prospects.segment ∈ {'camping','loisirs','chr','retail','revendeur','autre'}. « camping » est un segment À PART ENTIÈRE — l'hôtellerie de plein air n'est ni du loisir indoor (bowling, parc, salle d'arcade), ni du CHR, qui désigne Cafés, Hôtels, Restaurants.
    * prospects.source ∈ {'naf' (import sectoriel par code NAF depuis l'INSEE), 'signal' (établissement récemment créé, détecté via Pappers), 'linkedin' (lead remonté depuis La Growth Machine)}.
    * prospects.groupe = enseigne de rattachement (Capfun, Siblu, Sunêlia, Chadotel…) ou « Réseau <NOM DU DIRIGEANT> » quand le réseau n'est pas déclaré. groupe IS NULL signifie exploitant INDÉPENDANT — c'est la distinction commerciale clé : chez un indépendant le dirigeant décide, sur un site de réseau il faut remonter au siège.
    * prospects.etoiles = classement officiel de 1 à 5 (NULL si inconnu) ; prospects.capacite = nombre d'emplacements ; prospects.tag = cible de prospection (ex. 'Camping').
    * Ces trois derniers champs viennent d'OpenStreetMap et ne sont renseignés que pour une partie des fiches : ne présente JAMAIS un décompte filtré sur etoiles ou capacite comme un total du segment.
    * JOIGNABILITÉ — prospects.email et prospects.telephone. Ils proviennent d'OpenStreetMap et du site web du prospect, et ne sont donc renseignés que pour une partie des fiches. « prospects joignables », « avec mail », « qu'on peut contacter » se traduisent par coalesce(email,'') <> '' (ajouter telephone si la question parle d'appeler). C'est un critère de prospection majeur : un prospect sans contact ne peut pas être travaillé. Précise toujours combien de fiches du périmètre ont un contact, pour qu'on ne confonde pas « aucun résultat » et « aucun contact connu ».

RÈGLES CRITIQUES :
1. Retourne UNIQUEMENT du JSON de la forme {"sql": "...", "count_sql": "...", "interpretation": "..."}. Rien d'autre.
   - "sql" = la liste des points à afficher (plafonnée à 500 lignes).
   - "count_sql" = OBLIGATOIRE. Une requête SELECT/WITH renvoyant UNE seule ligne et UNE seule colonne nommée "total" = COUNT(*) sur EXACTEMENT le même périmètre (mêmes filtres) que "sql", SANS aucun LIMIT et SANS ORDER BY. Elle sert à afficher le vrai total même si la liste est tronquée à 500.
     Exemple : SELECT COUNT(*)::bigint AS total FROM (... même corps sans LIMIT ...) t
     Si la question est un TOP N explicite (ex. "top 10"), count_sql renvoie N réellement disponible (COUNT sur le périmètre, plafonné mentalement au N demandé côté sql).
2. La requête DOIT commencer par SELECT ou WITH. Aucune écriture. Aucun ; multiple. Aucun schéma préfixé sauf public.
3. CONTRAT DE COLONNES — STRICT. "sql" renvoie TOUJOURS ces colonnes, avec ces alias EXACTS :
   code_client, nom, ville, lat, lng, ca_12m, ca_total, ca_periode, derniere_commande, categorie
   - Les coordonnées DOIVENT s'appeler "lat" et "lng" (jamais latitude/longitude/lon) : SELECT c.lat AS lat, c.lng AS lng, c.name AS nom, c.ville AS ville.
   - ca_12m = somme montant_ht sur les 12 derniers mois (gaia_ventes UNION gaia_historique)
   - ca_total = somme montant_ht sur toutes années (union des 2 tables)
   - ca_periode = SI la question mentionne une PÉRIODE ou une ANNÉE précise (ex. "en 2026", "sur 2025", "depuis janvier", "au T3 2026"...) → SUM(montant_ht) filtré sur cette période (union des 2 tables). SINON → NULL.
   - derniere_commande = max(invoice_date)
   - categorie : selon les DÉFINITIONS MÉTIER ci-dessus (12 / 24 mois), sans exception.
   Même pour une question de dénombrement ("combien de …"), "sql" renvoie la LISTE des entités (avec lat/lng), jamais un simple COUNT : le total vient de count_sql.
4. Filtre TOUJOURS lat IS NOT NULL AND lng IS NOT NULL (sinon le point n'est pas affichable sur la carte).
5. Limite à 500 lignes max dans "sql" uniquement (jamais dans count_sql).
6. Régions françaises → départements via LEFT(code_postal, 2) (et implicitement pays = 'FR') :
   Bretagne = ('22','29','35','56'); Normandie = ('14','27','50','61','76'); PACA = ('04','05','06','13','83','84'); Île-de-France = ('75','77','78','91','92','93','94','95'); Auvergne-Rhône-Alpes = ('01','03','07','15','26','38','42','43','63','69','73','74'); Hauts-de-France = ('02','59','60','62','80'); Nouvelle-Aquitaine = ('16','17','19','23','24','33','40','47','64','79','86','87'); Occitanie = ('09','11','12','30','31','32','34','46','48','65','66','81','82'); Grand Est = ('08','10','51','52','54','55','57','67','68','88'); Pays de la Loire = ('44','49','53','72','85'); Centre-Val de Loire = ('18','28','36','37','41','45'); Bourgogne-Franche-Comté = ('21','25','39','58','70','71','89','90'); Corse = ('2A','2B').
7. RÈGLE PÉRIODE — TRÈS IMPORTANT : quand une année/période/plage temporelle est demandée (explicite OU implicite), tu DOIS :
   (a) calculer ca_periode = SUM(montant_ht) FILTER (WHERE <condition période>) sur l'UNION gaia_ventes + gaia_historique,
   (b) filtrer les clients pour ne garder que ceux avec ca_periode > 0,
   (c) TRIER exclusivement par ca_periode DESC (jamais par ca_total),
   (d) NE PAS classer/afficher ca_total comme critère principal — ca_total reste renseigné à titre indicatif uniquement.
   Sans période demandée → ca_periode = NULL et tri par ca_total (ou par la métrique demandée).
   Toutes les formulations temporelles courantes doivent être interprétées.
8. Pour "autour de Lyon" ou proximité géographique : filtre par département correspondant, ou par bounding box lat/lng si mentionné explicitement.
9. "Clients en France" / "top clients France" → filtre c.pays = 'FR' (JAMAIS 'France').
10. Pattern recommandé : CTE "v" avec UNION ALL entre gaia_ventes et gaia_historique, puis agrégation par code_client, join sur gaia_clients.

EXEMPLE — top 10 clients en France en 2026 (période demandée → tri sur ca_periode) :
sql = WITH v AS (SELECT code_client, invoice_date, montant_ht FROM gaia_ventes UNION ALL SELECT code_client, invoice_date, montant_ht FROM gaia_historique), agg AS (SELECT code_client, SUM(montant_ht) FILTER (WHERE invoice_date >= CURRENT_DATE - interval '12 months') AS ca_12m, SUM(montant_ht) AS ca_total, SUM(montant_ht) FILTER (WHERE EXTRACT(year FROM invoice_date) = 2026) AS ca_periode, MAX(invoice_date) AS derniere_commande FROM v GROUP BY code_client) SELECT c.customer_id AS code_client, c.name AS nom, c.ville AS ville, c.lat AS lat, c.lng AS lng, COALESCE(a.ca_12m,0) AS ca_12m, COALESCE(a.ca_total,0) AS ca_total, COALESCE(a.ca_periode,0) AS ca_periode, a.derniere_commande, CASE WHEN a.derniere_commande >= CURRENT_DATE - interval '12 months' THEN 'actif' WHEN a.derniere_commande >= CURRENT_DATE - interval '24 months' THEN 'dormant' ELSE 'inactif' END AS categorie FROM gaia_clients c JOIN agg a ON a.code_client = c.customer_id WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.pays = 'FR' AND COALESCE(a.ca_periode,0) > 0 ORDER BY a.ca_periode DESC NULLS LAST LIMIT 10

EXEMPLE — "combien de clients dormants ?" :
count_sql = WITH v AS (SELECT code_client, invoice_date FROM gaia_ventes UNION ALL SELECT code_client, invoice_date FROM gaia_historique), agg AS (SELECT code_client, MAX(invoice_date) AS derniere_commande FROM v GROUP BY code_client) SELECT COUNT(*)::bigint AS total FROM gaia_clients c JOIN agg a ON a.code_client = c.customer_id WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND a.derniere_commande < CURRENT_DATE - interval '12 months' AND a.derniere_commande >= CURRENT_DATE - interval '24 months'`;

// Sécurité : plus AUCUNE analyse du SQL côté edge function (les whitelists par
// regex produisaient des faux positifs : CTE ou colonne pris pour une table).
// La base impose elle-même le moindre privilège : gaia_query exécute
// la requête sous le rôle copilot_readonly (SELECT sur 6 tables, aucune écriture),
// avec statement_timeout 5s et un plafond de 500 lignes.
// Le contrôle de rôle admin/direction ci-dessous reste indispensable.
function validateSql(sql: string): { ok: true } | { ok: false; error: string } {
  const q = (sql ?? '').trim();
  if (!q) return { ok: false, error: 'Requête vide' };
  if (!/^(select|with)\s/i.test(q)) return { ok: false, error: 'Requête non SELECT' };
  const trimmed = q.replace(/;\s*$/, '');
  if (trimmed.includes(';')) return { ok: false, error: 'Instructions multiples interdites' };
  return { ok: true };
}



function jsonErr(status: number, error: string, debug?: string, includeDebug = false) {
  const payload: Record<string, unknown> = { error, message: error };
  if (includeDebug && debug) payload.debug = debug;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const MSG_OVERLOAD = 'Le service IA est momentanément saturé. Réessaie dans quelques secondes.';
const MSG_TIMEOUT = 'La requête a pris trop de temps. Réessaie ou reformule plus simplement.';
const MSG_SQL = "Je n'ai pas pu exécuter cette recherche en toute sécurité. Reformule autrement.";
const MSG_PARSE = 'Je n\'ai pas compris la question. Essaie par exemple : "top 10 clients en Bretagne en 2026".';

const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const DELAYS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class AiError extends Error {
  constructor(public kind: 'overload' | 'timeout' | 'fatal', public detail: string) {
    super(detail);
  }
}

async function callAnthropicWithRetry(apiKey: string, question: string): Promise<any> {
  let lastDetail = '';
  let lastKind: 'overload' | 'timeout' | 'fatal' = 'overload';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    let resp: Response | null = null;
    let netErr: unknown = null;
    let timedOut = false;

    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: question }],
        }),
      });
    } catch (e) {
      netErr = e;
      timedOut = (e as any)?.name === 'AbortError';
    } finally {
      clearTimeout(timer);
    }

    if (resp?.ok) {
      console.log(`[carte-copilot] anthropic attempt ${attempt}: 200`);
      return await resp.json();
    }

    const status = resp?.status ?? 0;
    console.log(
      `[carte-copilot] anthropic attempt ${attempt}: ${timedOut ? 'timeout' : netErr ? 'network' : status}`,
    );

    if (resp && !RETRYABLE.has(status)) {
      const body = await resp.text().catch(() => '');
      throw new AiError('fatal', `Anthropic ${status}: ${body.slice(0, 400)}`);
    }

    lastKind = timedOut ? 'timeout' : 'overload';
    lastDetail = timedOut
      ? 'Timeout 30s'
      : netErr
        ? `Erreur réseau: ${(netErr as any)?.message}`
        : `Anthropic ${status}: ${(await resp!.text().catch(() => '')).slice(0, 300)}`;

    if (attempt === 3) break;
    let wait = DELAYS[attempt - 1] + Math.floor(Math.random() * 300);
    const ra = resp?.headers.get('retry-after');
    if (ra) {
      const s = Number(ra);
      if (Number.isFinite(s) && s > 0) wait = Math.min(s * 1000, 15_000);
    }
    await sleep(wait);
  }

  throw new AiError(lastKind, lastDetail);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return jsonErr(401, 'Unauthorized');
    const jwt = authHeader.slice(7);
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonErr(401, 'Unauthorized');

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const uid = userData.user.id;
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
    const isAdminOrDirection = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    if (!isAdminOrDirection) return jsonErr(403, 'Accès réservé à la direction');


    const body = await req.json().catch(() => ({}));
    const question = String(body.question || '').trim();
    if (!question) return jsonErr(400, 'question manquante');
    if (question.length > 500) return jsonErr(400, 'question trop longue');

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonErr(500, "IA non configurée");

    let sql = '';
    let countSql = '';
    let interpretation = question;
    let rawText = '';
    let parseError: string | null = null;

    const tryInterpret = async (): Promise<boolean> => {
      const data = await callAnthropicWithRetry(apiKey, question);
      const textBlock = Array.isArray(data?.content)
        ? data.content.find((b: any) => b?.type === 'text')
        : null;
      rawText = (textBlock?.text ?? '').trim();
      if (!rawText) { parseError = `aucun bloc texte (stop_reason=${data?.stop_reason})`; return false; }
      const cleaned = rawText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) { parseError = 'aucun JSON détecté'; return false; }
      try {
        const parsed = JSON.parse(match[0]);
        const s = String(parsed.sql || '').trim();
        if (!s) { parseError = 'champ sql vide'; return false; }
        sql = s;
        countSql = String(parsed.count_sql || '').trim();
        interpretation = String(parsed.interpretation || question);
        return true;
      } catch (err: any) {
        parseError = `JSON invalide (${err?.message ?? 'parse error'})`;
        return false;
      }
    };

    try {
      let ok = await tryInterpret();
      if (!ok) {
        console.warn('[carte-copilot] interprétation échouée, nouvel essai', { parseError });
        ok = await tryInterpret();
      }
      if (!ok) {
        console.error('[carte-copilot] interprétation impossible', { parseError, rawText: rawText.slice(0, 300) });
        return jsonErr(422, MSG_PARSE, `${parseError ?? 'inconnu'} — ${rawText.slice(0, 300) || '(vide)'}`, true);
      }
    } catch (e) {
      const err = e as AiError;
      console.error('[carte-copilot] appel IA échoué', err?.detail ?? e);
      if (err?.kind === 'timeout') return jsonErr(504, MSG_TIMEOUT, err.detail, true);
      if (err?.kind === 'overload') return jsonErr(503, MSG_OVERLOAD, err.detail, true);
      return jsonErr(502, MSG_OVERLOAD, err?.detail ?? String(e), true);
    }

    const check = validateSql(sql);
    if (!check.ok) {
      console.warn('[carte-copilot] SQL rejeté', check.error, sql);
      return jsonErr(400, MSG_SQL, `${check.error} — SQL: ${sql.slice(0, 400)}`, true);
    }

    // Exécute via gaia_query (SECURITY INVOKER — RLS + whitelist SQL appliquées).
    const { data, error } = await sb.rpc('gaia_query' as any, { sql_query: sql });
    if (error) {
      console.error('[carte-copilot] gaia_query error', error, sql);
      return jsonErr(400, MSG_SQL, `${error.message} — SQL: ${sql.slice(0, 400)}`, true);
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in (data as any)) {
      return jsonErr(400, MSG_SQL, `${(data as any).error} — SQL: ${sql.slice(0, 400)}`, true);
    }


    const rows = Array.isArray(data) ? data : (data as any)?.rows ?? [];

    // Total réel : COUNT(*) sans plafond, exécuté séparément de la liste des points.
    let total: number | null = null;
    if (countSql && validateSql(countSql).ok && !/\blimit\b/i.test(countSql)) {
      const { data: cData, error: cErr } = await sb.rpc('gaia_query' as any, {
        sql_query: countSql,
      });
      if (cErr) {
        console.warn('[carte-copilot] count_sql erreur', cErr.message, countSql);
      } else {
        const cRows = Array.isArray(cData) ? cData : (cData as any)?.rows ?? [];
        const first = cRows[0];
        if (first && typeof first === 'object') {
          const raw = (first as any).total ?? Object.values(first as any)[0];
          const n = Number(raw);
          if (Number.isFinite(n)) total = n;
        }
      }
    }
    const truncated = rows.length >= 500;
    if (total == null) total = truncated ? null : rows.length;

    return new Response(
      JSON.stringify({
        interpretation,
        sql,
        count_sql: countSql || null,
        rows,
        count: rows.length,
        total,
        truncated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[carte-copilot]', e);
    return jsonErr(500, "Une erreur est survenue. Réessaie dans quelques instants.", e?.message, true);
  }
});
