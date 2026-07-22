
CREATE INDEX IF NOT EXISTS idx_gc_client ON public.gaia_commandes(code_client);
CREATE INDEX IF NOT EXISTS idx_gc_invdate ON public.gaia_commandes(invoice_date);

DROP MATERIALIZED VIEW IF EXISTS public.mv_gaia_resume_client_exercice CASCADE;
CREATE MATERIALIZED VIEW public.mv_gaia_resume_client_exercice AS
WITH base AS (
  SELECT
    EXTRACT(year FROM l.invoice_date + interval '4 months')::int AS annee,
    COALESCE(g.groupe, cl.name, l.code_client) AS client,
    l.invoice_date,
    l.montant_ht,
    trim(l.code_article) AS code_article
  FROM public.v_gaia_lignes l
  LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
  LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
  WHERE l.invoice_date IS NOT NULL
    AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
),
agg AS (
  SELECT
    annee, client,
    SUM(montant_ht) AS ca_ht,
    MIN(invoice_date) AS premiere_facture,
    MAX(invoice_date) AS derniere_facture,
    COUNT(*) AS nb_lignes
  FROM base
  GROUP BY annee, client
),
marge_agg AS (
  -- v_gaia_marge_client peut avoir plusieurs lignes pour un même libellé « client »
  -- (homonymes avec plusieurs code_client) — on agrège d'abord.
  SELECT annee, client,
         SUM(ca_avec_cout)   AS ca_avec_cout,
         SUM(marge_estimee)  AS marge_estimee,
         CASE WHEN SUM(ca_ht) > 0 THEN SUM(ca_avec_cout) / SUM(ca_ht) * 100 END AS part_reelle
  FROM public.v_gaia_marge_client
  GROUP BY annee, client
),
famille_agg AS (
  SELECT b.annee, b.client,
         COALESCE(a.famille, 'Pièces & divers') AS famille,
         SUM(b.montant_ht) AS ca
  FROM base b
  LEFT JOIN public.v_gaia_articles a ON a.code = b.code_article
  GROUP BY b.annee, b.client, COALESCE(a.famille, 'Pièces & divers')
),
famille AS (
  SELECT DISTINCT ON (annee, client) annee, client, famille AS famille_dominante
  FROM famille_agg
  ORDER BY annee, client, ca DESC NULLS LAST
)
SELECT
  a.annee,
  a.client,
  a.ca_ht,
  m.ca_avec_cout,
  m.marge_estimee,
  m.part_reelle,
  a.nb_lignes,
  a.premiere_facture,
  a.derniere_facture,
  f.famille_dominante
FROM agg a
LEFT JOIN marge_agg m ON m.annee = a.annee AND m.client = a.client
LEFT JOIN famille   f ON f.annee = a.annee AND f.client = a.client;

CREATE UNIQUE INDEX mv_gaia_resume_client_exercice_pk
  ON public.mv_gaia_resume_client_exercice(annee, client);
CREATE INDEX mv_gaia_resume_client_exercice_client_idx
  ON public.mv_gaia_resume_client_exercice(client);

REVOKE ALL ON public.mv_gaia_resume_client_exercice FROM PUBLIC;
REVOKE ALL ON public.mv_gaia_resume_client_exercice FROM anon, authenticated;
GRANT SELECT ON public.mv_gaia_resume_client_exercice TO service_role;

DROP MATERIALIZED VIEW IF EXISTS public.mv_gaia_resume_mensuel CASCADE;
CREATE MATERIALIZED VIEW public.mv_gaia_resume_mensuel AS
WITH ca AS (
  SELECT date_trunc('month', invoice_date)::date AS mois,
         EXTRACT(year FROM invoice_date + interval '4 months')::int AS annee,
         SUM(montant_ht) AS ca_ht,
         COUNT(*) AS lignes
  FROM public.v_gaia_lignes
  WHERE invoice_date IS NOT NULL
    AND code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
  GROUP BY 1, 2
),
mg AS (
  SELECT date_trunc('month', invoice_date)::date AS mois,
         SUM(marge_ligne) AS marge_estimee,
         SUM(cout_total)  AS cout_estime
  FROM public.v_gaia_lignes_marge
  WHERE invoice_date IS NOT NULL
  GROUP BY 1
)
SELECT ca.mois, ca.annee, ca.ca_ht, ca.lignes, mg.marge_estimee, mg.cout_estime
FROM ca LEFT JOIN mg ON mg.mois = ca.mois;

CREATE UNIQUE INDEX mv_gaia_resume_mensuel_pk ON public.mv_gaia_resume_mensuel(mois);

REVOKE ALL ON public.mv_gaia_resume_mensuel FROM PUBLIC;
REVOKE ALL ON public.mv_gaia_resume_mensuel FROM anon, authenticated;
GRANT SELECT ON public.mv_gaia_resume_mensuel TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_gaia_resumes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_gaia_resume_client_exercice;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.mv_gaia_resume_client_exercice;
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_gaia_resume_mensuel;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.mv_gaia_resume_mensuel;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_gaia_resumes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_gaia_resumes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_gaia_resumes() TO service_role;

REFRESH MATERIALIZED VIEW public.mv_gaia_resume_client_exercice;
REFRESH MATERIALIZED VIEW public.mv_gaia_resume_mensuel;

CREATE OR REPLACE FUNCTION public.gaia_query(sql_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb;
  n int;
BEGIN
  IF sql_query !~* '^\s*(select|with)\s' THEN
    RETURN jsonb_build_object('error', 'Seules les requêtes SELECT sont autorisées');
  END IF;
  IF sql_query ~* '(insert|update|delete|drop|alter|create|grant|truncate)\s' THEN
    RETURN jsonb_build_object('error', 'Mot-clé interdit détecté');
  END IF;
  SET LOCAL statement_timeout = '8s';
  SET TRANSACTION READ ONLY;
  EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 501) t', sql_query)
    INTO rows;
  n := COALESCE(jsonb_array_length(rows), 0);
  IF n > 500 THEN
    RETURN jsonb_build_object(
      'rows', (SELECT jsonb_agg(x) FROM (SELECT jsonb_array_elements(rows) AS x LIMIT 500) s),
      'truncated', true,
      'note', 'Résultat tronqué à 500 lignes. Agrège dans le SQL (SUM/COUNT/GROUP BY) plutôt que de récupérer des lignes brutes, ou interroge d''abord mv_gaia_resume_client_exercice / mv_gaia_resume_mensuel.'
    );
  END IF;
  RETURN rows;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
