import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-sonnet-5';

const SYSTEM = `Tu es un assistant SQL pour Arcade OS (Avranches Automatic). Tu transformes une question en français en UNE seule requête SQL PostgreSQL, en LECTURE SEULE, exécutée via la fonction gaia_query_restricted (SELECT / WITH uniquement).

TABLES AUTORISÉES (whitelist stricte — toute autre table est refusée par le moteur) :
- gaia_clients(customer_id text, name text, status text, typologie text, adresse1, adresse2, code_postal text, ville text, pays text, lat numeric, lng numeric)
- gaia_ventes(code_client text, invoice_date date, qty numeric, pu_rem numeric, montant_ht numeric, code_article text, tran_type text, classe_article text)  -- ventes récentes
- gaia_historique(code_client text, invoice_date date, qty numeric, pu_rem numeric, montant_ht numeric, code_article text, classe_article text)  -- ventes archivées
- prospects(id uuid, entreprise text, ville text, statut text, segment text, lat numeric, lng numeric, montant_estime numeric)
- catalogue_erp(code text, description text, famille text, prix_ht numeric)
- client_actions(code_client text, type text, date timestamptz, auteur_id uuid)

TU N'AS PAS ACCÈS aux tables profiles, user_roles, allowed_emails, invitations, notifications, gaia_commandes, gaia_achats, gaia_stock, aux schémas auth/storage/vault/pg_catalog/information_schema, ni aux vues v_gaia_* / mv_gaia_*. Toute requête qui les cite sera rejetée : NE LES MENTIONNE JAMAIS.

CONVENTIONS DES DONNÉES (TRÈS IMPORTANT) :
- gaia_clients.pays est un CODE ISO-2 en majuscules, JAMAIS le nom du pays. Valeurs réelles : 'FR' (France), 'BE' (Belgique), 'CH' (Suisse), 'DE' (Allemagne), 'ES' (Espagne), 'GB' (Royaume-Uni), 'IT' (Italie), 'LU' (Luxembourg), 'NL' (Pays-Bas), 'PT' (Portugal), 'MA' (Maroc), 'DZ' (Algérie), 'TN' (Tunisie), 'CI', 'SN', 'CD', 'CG', 'GA', 'DJ', 'GF' (Guyane), 'GP' (Guadeloupe), 'MQ', 'RE', 'YT', 'NC', 'PF', et divers autres. Écris TOUJOURS c.pays = 'FR' pour "France", jamais c.pays = 'France'.
- gaia_clients.typologie ∈ {'Client direct','Distributeur','Evénementiel','Forain','Opérateur','Particulier','Site Internet'}.
- catalogue_erp.famille ∈ {'Accessoires','Basket','Changeurs','Composants','Conduites','Consommables','Enfant','Flippers','Grues','Jetons','Jeux d'adresse','Jeux de café','Jeux de force','Main d'oeuvre','Merchandising','Occasion','Palets','Pièces détachées','Theming','Tirs','Vending'}.
- catégorie client dérivée : 'actif' si derniere_commande >= now() - interval '12 months', 'dormant' entre 12 et 36 mois, 'inactif' au-delà (ou jamais).
- Pour tout filtre texte incertain (nom ville, nom client, famille libre…) : utilise ILIKE '%…%' et unaccent si nécessaire, jamais l'égalité stricte.

RÈGLES CRITIQUES :
1. Retourne UNIQUEMENT du JSON de la forme {"sql": "...", "interpretation": "..."}. Rien d'autre.
2. La requête DOIT commencer par SELECT ou WITH. Aucune écriture. Aucun ; multiple. Aucun schéma préfixé sauf public.
3. Renvoie TOUJOURS ces colonnes exactement dans cet ordre :
   code_client, nom, ville, lat, lng, ca_12m, ca_total, ca_periode, derniere_commande, categorie
   - ca_12m = somme montant_ht sur les 12 derniers mois (gaia_ventes UNION gaia_historique)
   - ca_total = somme montant_ht sur toutes années (union des 2 tables)
   - ca_periode = SI la question mentionne une PÉRIODE ou une ANNÉE précise (ex. "en 2026", "sur 2025", "depuis janvier", "au T3 2026"...) → SUM(montant_ht) filtré sur cette période (union des 2 tables). SINON → NULL.
   - derniere_commande = max(invoice_date)
   - categorie : 'actif' si derniere_commande >= now() - interval '12 months', 'dormant' si entre 12 et 36 mois, sinon 'inactif'
4. Filtre TOUJOURS lat IS NOT NULL AND lng IS NOT NULL (sinon le point n'est pas affichable sur la carte).
5. Limite à 500 lignes max.
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
WITH v AS (SELECT code_client, invoice_date, montant_ht FROM gaia_ventes UNION ALL SELECT code_client, invoice_date, montant_ht FROM gaia_historique), agg AS (SELECT code_client, SUM(montant_ht) FILTER (WHERE invoice_date >= now() - interval '12 months') AS ca_12m, SUM(montant_ht) AS ca_total, SUM(montant_ht) FILTER (WHERE EXTRACT(year FROM invoice_date) = 2026) AS ca_periode, MAX(invoice_date) AS derniere_commande FROM v GROUP BY code_client) SELECT c.customer_id AS code_client, c.name AS nom, c.ville, c.lat, c.lng, COALESCE(a.ca_12m,0) AS ca_12m, COALESCE(a.ca_total,0) AS ca_total, COALESCE(a.ca_periode,0) AS ca_periode, a.derniere_commande, CASE WHEN a.derniere_commande >= now() - interval '12 months' THEN 'actif' WHEN a.derniere_commande >= now() - interval '36 months' THEN 'dormant' ELSE 'inactif' END AS categorie FROM gaia_clients c JOIN agg a ON a.code_client = c.customer_id WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.pays = 'FR' AND COALESCE(a.ca_periode,0) > 0 ORDER BY a.ca_periode DESC NULLS LAST LIMIT 10;`;

const ALLOWED_TABLES = new Set([
  'gaia_clients','gaia_ventes','gaia_historique',
  'catalogue_erp','prospects','client_actions',
]);

const FORBIDDEN_SCHEMA_RE = /\b(auth|storage|vault|realtime|supabase_functions|pg_catalog|pg_temp|information_schema|pg_policies|pg_roles|pg_shadow|pg_user)\./i;
const FORBIDDEN_FN_RE = /\b(pg_read_|pg_ls_|pg_stat_file|dblink|copy_from|lo_import|lo_export|current_setting|set_config|pg_sleep|pg_terminate|pg_cancel|pg_reload)\b/i;
const FORBIDDEN_KW_RE = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|comment|copy|call|do|vacuum|analyze|reindex|cluster|refresh|listen|notify|lock|set|reset|show|begin|commit|rollback|savepoint|execute|prepare|deallocate|attach|detach)\b/i;

function validateSql(sql: string): { ok: true } | { ok: false; error: string } {
  if (!/^\s*(select|with)\s/i.test(sql)) return { ok: false, error: 'Requête non SELECT' };
  if (sql.includes(';') && sql.replace(/;\s*$/, '').includes(';'))
    return { ok: false, error: 'Instructions multiples interdites' };
  if (FORBIDDEN_KW_RE.test(sql)) return { ok: false, error: 'Mot-clé interdit' };
  if (FORBIDDEN_SCHEMA_RE.test(sql)) return { ok: false, error: 'Schéma non autorisé' };
  if (FORBIDDEN_FN_RE.test(sql)) return { ok: false, error: 'Fonction non autorisée' };

  const cleaned = sql
    .replace(/'([^']|'')*'/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .toLowerCase();

  const re = /(?:from|join)\s+(?:only\s+)?([a-z_][a-z0-9_$]*(?:\.[a-z_][a-z0-9_$]*)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    let ident = m[1];
    if (ident.includes('.')) {
      const [schema, name] = ident.split('.');
      if (schema !== 'public') return { ok: false, error: `Objet non autorisé : ${ident}` };
      ident = name;
    }
    if (!ALLOWED_TABLES.has(ident)) {
      return { ok: false, error: `Table hors whitelist : ${ident}` };
    }
  }
  return { ok: true };
}


function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
    const [{ data: roles }, { data: menu }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', uid),
      admin.from('user_menu_access').select('allowed').eq('user_id', uid).eq('section_key', 'commerce.carte').maybeSingle(),
    ]);
    const isAdminOrDirection = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    // Accès menu explicite : true = autorisé, false = refusé, null = fallback role admin/direction.
    const menuAllowed = (menu as any)?.allowed;
    const allowed = menuAllowed === true || (menuAllowed !== false && isAdminOrDirection);
    if (!allowed) return jsonErr(403, 'Accès Carte non autorisé');


    const body = await req.json().catch(() => ({}));
    const question = String(body.question || '').trim();
    if (!question) return jsonErr(400, 'question manquante');
    if (question.length > 500) return jsonErr(400, 'question trop longue');

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonErr(500, "IA non configurée");

    let sql = '';
    let interpretation = question;
    try {
      const resp = await anthropicJson(apiKey, {
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: 'user', content: question }],
      });
      const text = (resp?.content?.[0]?.text ?? '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Réponse IA invalide');
      const parsed = JSON.parse(match[0]);
      sql = String(parsed.sql || '').trim();
      interpretation = String(parsed.interpretation || question);
    } catch (e) {
      if (isAnthropicOverload(e)) return jsonErr(503, (e as any).userMessage);
      console.error('AI parse error', e);
      return jsonErr(500, "Impossible d'interpréter la question");
    }

    if (!sql) return jsonErr(400, 'SQL vide');
    const upper = sql.toUpperCase().replace(/\s+/g, ' ');
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return jsonErr(400, 'Requête non SELECT');
    if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|TRUNCATE|REVOKE)\b/.test(upper)) {
      return jsonErr(400, 'Requête non autorisée');
    }

    // Exécute via gaia_query (user JWT — RLS + garde-fous appliqués)
    const { data, error } = await sb.rpc('gaia_query' as any, { sql_query: sql });
    if (error) {
      console.error('gaia_query error', error);
      return jsonErr(400, `Erreur SQL : ${error.message}`);
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in (data as any)) {
      return jsonErr(400, `Erreur SQL : ${(data as any).error}`);
    }

    const rows = Array.isArray(data) ? data : (data as any)?.rows ?? [];

    return new Response(
      JSON.stringify({ interpretation, sql, rows, count: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error(e);
    return jsonErr(500, e?.message || 'Erreur serveur');
  }
});
