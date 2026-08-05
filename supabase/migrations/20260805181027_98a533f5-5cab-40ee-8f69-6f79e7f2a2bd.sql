-- 1. layout_snapshots : plus d'accès anonyme
DROP POLICY IF EXISTS "Anyone can insert layout snapshots" ON public.layout_snapshots;
DROP POLICY IF EXISTS "Anyone can read layout snapshots" ON public.layout_snapshots;
REVOKE ALL ON public.layout_snapshots FROM anon;
GRANT SELECT, INSERT ON public.layout_snapshots TO authenticated;
GRANT ALL ON public.layout_snapshots TO service_role;
CREATE POLICY "layout_snapshots_auth_select" ON public.layout_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "layout_snapshots_auth_insert" ON public.layout_snapshots
  FOR INSERT TO authenticated WITH CHECK (true);

-- 2. prospects : le rôle de lecture du copilote respecte le périmètre prospection
DROP POLICY IF EXISTS copilot_readonly_select ON public.prospects;
GRANT EXECUTE ON FUNCTION public.can_access_prospection(uuid) TO copilot_readonly;
CREATE POLICY copilot_readonly_select ON public.prospects
  FOR SELECT TO copilot_readonly USING (public.can_access_prospection());

-- 3. search_path figé
ALTER FUNCTION public.empreinte_etablissement(text, text) SET search_path = public;

-- 4. Contrôles d'accès internes sur les fonctions SECURITY DEFINER exposées
CREATE OR REPLACE FUNCTION public.get_gaia_exercices()
 RETURNS TABLE(annee integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_dashboard() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT DISTINCT v.annee FROM public.v_gaia_ca_client v WHERE v.annee IS NOT NULL ORDER BY v.annee DESC;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_ca_client(_annee integer, _annee_prev integer)
 RETURNS TABLE(code_client text, client text, ca_current numeric, ca_prev numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_dashboard() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    MAX(v.code_client) AS code_client,
    v.client,
    COALESCE(SUM(v.ca_ht) FILTER (WHERE v.annee = _annee), 0) AS ca_current,
    COALESCE(SUM(v.ca_ht) FILTER (WHERE v.annee = _annee_prev), 0) AS ca_prev
  FROM public.v_gaia_ca_client v
  WHERE v.client IS NOT NULL
    AND v.annee IN (_annee, _annee_prev)
  GROUP BY v.client
  HAVING COALESCE(SUM(v.ca_ht) FILTER (WHERE v.annee = _annee), 0) > 0
      OR COALESCE(SUM(v.ca_ht) FILTER (WHERE v.annee = _annee_prev), 0) > 0
  ORDER BY 3 DESC;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_briefing_activite_hebdo()
 RETURNS TABLE(jour date, type_doc text, univers text, n_docs integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_dashboard() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH lignes AS (SELECT c.n_cde, CASE c.type_cde WHEN 'QT' THEN 'devis' ELSE 'commande' END AS type_doc, c.invoice_date,
    CASE WHEN c.classe_article ILIKE 'JEUX%' THEN 'jeux' ELSE 'magasin' END AS univ, coalesce(c.montant_ht,0) AS m
    FROM public.gaia_commandes c WHERE c.type_cde IN ('QT','SO')
      AND c.invoice_date >= date_trunc('week',CURRENT_DATE)::date - 7 AND c.invoice_date < date_trunc('week',CURRENT_DATE)::date + 7),
  doc AS (SELECT l.n_cde, max(l.type_doc) AS type_doc, min(l.invoice_date) AS jour, (array_agg(l.univ ORDER BY l.m DESC))[1] AS univers FROM lignes l GROUP BY l.n_cde)
  SELECT d.jour, d.type_doc, d.univers, count(*)::int FROM doc d GROUP BY 1,2,3;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_briefing_jour_docs(_jour date)
 RETURNS TABLE(n_cde text, type_doc text, code_client text, montant_ht numeric, univers text, proprietaire text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_dashboard() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH lignes AS (SELECT c.n_cde, CASE c.type_cde WHEN 'QT' THEN 'devis' ELSE 'commande' END AS type_doc, c.code_client, c.proprietaire_id,
    CASE WHEN c.classe_article ILIKE 'JEUX%' THEN 'jeux' ELSE 'magasin' END AS univ, coalesce(c.montant_ht,0) AS m
    FROM public.gaia_commandes c WHERE c.type_cde IN ('QT','SO') AND c.invoice_date = _jour),
  doc AS (SELECT l.n_cde, max(l.type_doc) AS type_doc, max(l.code_client) AS code_client, max(l.proprietaire_id) AS proprietaire_id, sum(l.m) AS montant_ht, (array_agg(l.univ ORDER BY l.m DESC))[1] AS univers FROM lignes l GROUP BY l.n_cde)
  SELECT d.n_cde, d.type_doc, d.code_client, d.montant_ht, d.univers, e.nom
  FROM doc d LEFT JOIN public.gaia_equipe e ON e.contact_id = d.proprietaire_id ORDER BY d.montant_ht DESC;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_briefing_semaine_docs(_type_doc text)
 RETURNS TABLE(jour date, n_cde text, type_doc text, code_client text, montant_ht numeric, univers text, proprietaire text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_dashboard() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH bornes AS (
    SELECT date_trunc('week', current_date)::date AS lundi,
           (date_trunc('week', current_date) + interval '4 days')::date AS vendredi
  ),
  lignes AS (
    SELECT c.invoice_date AS jour, c.n_cde,
      CASE c.type_cde WHEN 'QT' THEN 'devis' ELSE 'commande' END AS type_doc,
      c.code_client, c.proprietaire_id,
      CASE WHEN c.classe_article ILIKE 'JEUX%' THEN 'jeux' ELSE 'magasin' END AS univ,
      coalesce(c.montant_ht,0) AS m
    FROM public.gaia_commandes c, bornes b
    WHERE c.type_cde IN ('QT','SO')
      AND c.invoice_date BETWEEN b.lundi AND b.vendredi
      AND ((_type_doc = 'devis' AND c.type_cde = 'QT') OR (_type_doc = 'commande' AND c.type_cde = 'SO'))
  ),
  doc AS (
    SELECT l.jour, l.n_cde,
      max(l.type_doc) AS type_doc,
      max(l.code_client) AS code_client,
      max(l.proprietaire_id) AS proprietaire_id,
      sum(l.m) AS montant_ht,
      (array_agg(l.univ ORDER BY l.m DESC))[1] AS univers
    FROM lignes l GROUP BY l.jour, l.n_cde
  )
  SELECT d.jour, d.n_cde, d.type_doc, d.code_client, d.montant_ht, d.univers, e.nom
  FROM doc d LEFT JOIN public.gaia_equipe e ON e.contact_id = d.proprietaire_id
  ORDER BY d.jour DESC, d.montant_ht DESC;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.refresh_gaia_resumes() FROM authenticated;