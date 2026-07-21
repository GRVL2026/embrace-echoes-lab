
-- 1. get_marge_client filtrable par exercice (évite la troncature 1000 lignes)
DROP FUNCTION IF EXISTS public.get_marge_client();
CREATE OR REPLACE FUNCTION public.get_marge_client(_annee integer DEFAULT NULL)
RETURNS TABLE(annee integer, client text, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, part_reelle numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.annee, v.client, v.ca_ht, v.ca_avec_cout, v.marge_estimee, v.part_reelle
    FROM public.v_gaia_marge_client v
    WHERE _annee IS NULL OR v.annee = _annee
    ORDER BY v.annee DESC, v.ca_ht DESC NULLS LAST;
END;
$function$;

-- 2. Agrégation SQL pour bandeaux totaux (direction/admin)
CREATE OR REPLACE FUNCTION public.get_marge_totaux(_annee integer)
RETURNS TABLE(nb_clients integer, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, taux_moyen numeric, couverture numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      COUNT(*)::int,
      COALESCE(SUM(v.ca_ht), 0),
      COALESCE(SUM(v.ca_avec_cout), 0),
      COALESCE(SUM(v.marge_estimee), 0),
      CASE WHEN COALESCE(SUM(v.ca_avec_cout),0) > 0
           THEN (SUM(v.marge_estimee) / SUM(v.ca_avec_cout)) * 100
           ELSE NULL END,
      CASE WHEN COALESCE(SUM(v.ca_ht),0) > 0
           THEN (SUM(v.ca_avec_cout) / SUM(v.ca_ht)) * 100
           ELSE NULL END
    FROM public.v_gaia_marge_client v
    WHERE v.annee = _annee;
END;
$function$;

-- 3. CA par client (courant + précédent) en une passe, sans risque de troncature
CREATE OR REPLACE FUNCTION public.get_ca_client(_annee integer, _annee_prev integer)
RETURNS TABLE(code_client text, client text, ca_current numeric, ca_prev numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- 4. Liste des exercices disponibles (utilitaire)
CREATE OR REPLACE FUNCTION public.get_gaia_exercices()
RETURNS TABLE(annee integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT v.annee FROM public.v_gaia_ca_client v WHERE v.annee IS NOT NULL ORDER BY v.annee DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_marge_client(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_marge_client(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_marge_totaux(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_marge_totaux(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ca_client(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_gaia_exercices() TO authenticated, service_role;
