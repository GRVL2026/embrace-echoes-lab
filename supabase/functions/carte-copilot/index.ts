import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { anthropicJson, isAnthropicOverload } from '../_shared/anthropic-fetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'claude-sonnet-5';

const SYSTEM = `Tu es un assistant SQL pour Arcade OS (Avranches Automatic). Tu transformes une question en français en UNE seule requête SQL PostgreSQL, en LECTURE SEULE, exécutée via la fonction gaia_query (SELECT / WITH uniquement).

TABLES DISPONIBLES :
- gaia_clients(customer_id text, name text, status text, typologie text, adresse1, adresse2, code_postal text, ville text, pays text, lat numeric, lng numeric)
- gaia_ventes(code_client text, invoice_date date, qty numeric, pu_rem numeric, montant_ht numeric, code_article text, tran_type text, classe_article text)  -- ventes récentes
- gaia_historique(code_client text, invoice_date date, qty numeric, pu_rem numeric, montant_ht numeric, code_article text, classe_article text)  -- ventes archivées
- prospects(id uuid, entreprise text, ville text, statut text, segment text, lat numeric, lng numeric, montant_estime numeric)
- catalogue_erp(code text, description text, famille text, prix_ht numeric)

CONVENTIONS DES DONNÉES (TRÈS IMPORTANT) :
- gaia_clients.pays est un CODE ISO-2 en majuscules, JAMAIS le nom du pays. Valeurs réelles : 'FR' (France), 'BE' (Belgique), 'CH' (Suisse), 'DE' (Allemagne), 'ES' (Espagne), 'GB' (Royaume-Uni), 'IT' (Italie), 'LU' (Luxembourg), 'NL' (Pays-Bas), 'PT' (Portugal), 'MA' (Maroc), 'DZ' (Algérie), 'TN' (Tunisie), 'CI', 'SN', 'CD', 'CG', 'GA', 'DJ', 'GF' (Guyane), 'GP' (Guadeloupe), 'MQ', 'RE', 'YT', 'NC', 'PF', et divers autres. Écris TOUJOURS c.pays = 'FR' pour "France", jamais c.pays = 'France'.
- gaia_clients.typologie ∈ {'Client direct','Distributeur','Evénementiel','Forain','Opérateur','Particulier','Site Internet'}.
- catalogue_erp.famille ∈ {'Accessoires','Basket','Changeurs','Composants','Conduites','Consommables','Enfant','Flippers','Grues','Jetons','Jeux d'adresse','Jeux de café','Jeux de force','Main d'oeuvre','Merchandising','Occasion','Palets','Pièces détachées','Theming','Tirs','Vending'}.
- catégorie client dérivée : 'actif' si derniere_commande >= now() - interval '12 months', 'dormant' entre 12 et 36 mois, 'inactif' au-delà (ou jamais).
- Pour tout filtre texte incertain (nom ville, nom client, famille libre…) : utilise ILIKE '%…%' et unaccent si nécessaire, jamais l'égalité stricte.

RÈGLES CRITIQUES :
1. Retourne UNIQUEMENT du JSON de la forme {"sql": "...", "interpretation": "..."}. Rien d'autre.
2. La requête DOIT commencer par SELECT ou WITH. Aucune écriture. Aucun ; multiple.
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
   Toutes les formulations temporelles courantes doivent être interprétées (JAMAIS renvoyer une erreur pour une plage temporelle) :
   - "en 2026" / "sur 2026" / "au cours de 2026" → EXTRACT(year FROM invoice_date) = 2026
   - "sur 2025-2026" / "2025 et 2026" → EXTRACT(year FROM invoice_date) IN (2025,2026)
   - "depuis 2025" / "à partir de 2025" → invoice_date >= '2025-01-01'
   - "depuis mars 2026" / "à partir de mars 2026" → invoice_date >= '2026-03-01'
   - "depuis 2 ans" / "sur 2 ans" / "24 derniers mois" → invoice_date >= current_date - interval '24 months'
   - "depuis 6 mois" / "6 derniers mois" → invoice_date >= current_date - interval '6 months'
   - "cette année" → EXTRACT(year FROM invoice_date) = EXTRACT(year FROM current_date)
   - "l'an dernier" / "année dernière" → EXTRACT(year FROM invoice_date) = EXTRACT(year FROM current_date) - 1
   - "avant 2022" / "jusqu'en 2022" (exclus) → invoice_date < '2022-01-01'
   - "jusqu'à 2022 inclus" → invoice_date <= '2022-12-31'
   - "entre 2023 et 2024" / "de 2023 à 2024" → invoice_date BETWEEN '2023-01-01' AND '2024-12-31'
   - "au T3 2026" → invoice_date >= '2026-07-01' AND invoice_date < '2026-10-01'
   - "au S1 2026" → invoice_date >= '2026-01-01' AND invoice_date < '2026-07-01'
   Dès qu'il y a le moindre doute sur la présence d'une période, PRIVILÉGIE l'interprétation temporelle plutôt qu'une erreur.
   Ne renvoie une erreur (JSON avec sql vide) QUE si la question est totalement inintelligible.
8. Pour "autour de Lyon" ou proximité géographique : filtre par département correspondant, ou par bounding box lat/lng si mentionné explicitement.
9. "Clients en France" / "top clients France" → filtre c.pays = 'FR' (JAMAIS 'France').
10. Pattern recommandé : CTE "v" avec UNION ALL entre gaia_ventes et gaia_historique, puis agrégation par code_client, join sur gaia_clients.

EXEMPLE 1 — top 10 clients en France en 2026 (période demandée → tri sur ca_periode) :
WITH v AS (SELECT code_client, invoice_date, montant_ht FROM gaia_ventes UNION ALL SELECT code_client, invoice_date, montant_ht FROM gaia_historique), agg AS (SELECT code_client, SUM(montant_ht) FILTER (WHERE invoice_date >= now() - interval '12 months') AS ca_12m, SUM(montant_ht) AS ca_total, SUM(montant_ht) FILTER (WHERE EXTRACT(year FROM invoice_date) = 2026) AS ca_periode, MAX(invoice_date) AS derniere_commande FROM v GROUP BY code_client) SELECT c.customer_id AS code_client, c.name AS nom, c.ville, c.lat, c.lng, COALESCE(a.ca_12m,0) AS ca_12m, COALESCE(a.ca_total,0) AS ca_total, COALESCE(a.ca_periode,0) AS ca_periode, a.derniere_commande, CASE WHEN a.derniere_commande >= now() - interval '12 months' THEN 'actif' WHEN a.derniere_commande >= now() - interval '36 months' THEN 'dormant' ELSE 'inactif' END AS categorie FROM gaia_clients c JOIN agg a ON a.code_client = c.customer_id WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.pays = 'FR' AND COALESCE(a.ca_periode,0) > 0 ORDER BY a.ca_periode DESC NULLS LAST LIMIT 10;

EXEMPLE 2 — top clients France toutes années (aucune période → ca_periode NULL, tri sur ca_total) :
WITH v AS (SELECT code_client, invoice_date, montant_ht FROM gaia_ventes UNION ALL SELECT code_client, invoice_date, montant_ht FROM gaia_historique), agg AS (SELECT code_client, SUM(montant_ht) FILTER (WHERE invoice_date >= now() - interval '12 months') AS ca_12m, SUM(montant_ht) AS ca_total, MAX(invoice_date) AS derniere_commande FROM v GROUP BY code_client) SELECT c.customer_id AS code_client, c.name AS nom, c.ville, c.lat, c.lng, COALESCE(a.ca_12m,0) AS ca_12m, COALESCE(a.ca_total,0) AS ca_total, NULL::numeric AS ca_periode, a.derniere_commande, CASE WHEN a.derniere_commande >= now() - interval '12 months' THEN 'actif' WHEN a.derniere_commande >= now() - interval '36 months' THEN 'dormant' ELSE 'inactif' END AS categorie FROM gaia_clients c JOIN agg a ON a.code_client = c.customer_id WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.pays = 'FR' ORDER BY a.ca_total DESC NULLS LAST LIMIT 10`;

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
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const allowed = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'direction');
    if (!allowed) return jsonErr(403, 'Forbidden');

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
