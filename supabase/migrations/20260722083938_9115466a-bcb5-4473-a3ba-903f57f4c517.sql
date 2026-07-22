-- 1. Fonctions de capacité
CREATE OR REPLACE FUNCTION public.can_marge_client(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('commercial','chef_ventes','direction','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_marge_globale(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('chef_ventes','direction','admin')
  );
$$;

-- 2. get_marge_client : détail par client → can_marge_client
CREATE OR REPLACE FUNCTION public.get_marge_client(_annee integer DEFAULT NULL::integer, _client text DEFAULT NULL::text)
 RETURNS TABLE(annee integer, client text, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, part_reelle numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_marge_client() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.annee, v.client, v.ca_ht, v.ca_avec_cout, v.marge_estimee, v.part_reelle
    FROM public.v_gaia_marge_client v
    WHERE (_annee IS NULL OR v.annee = _annee)
      AND (_client IS NULL OR v.client = _client)
    ORDER BY v.annee DESC, v.ca_ht DESC NULLS LAST;
END;
$function$;

-- 3. get_marge_famille : agrégé → can_marge_globale
CREATE OR REPLACE FUNCTION public.get_marge_famille()
 RETURNS TABLE(annee integer, famille text, ca_ht numeric, ca_avec_cout numeric, cout_estime numeric, marge_estimee numeric, part_reelle numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_marge_globale() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.annee, v.famille, v.ca_ht, v.ca_avec_cout, v.cout_estime, v.marge_estimee, v.part_reelle
               FROM public.v_gaia_marge_famille v;
END; $function$;

-- 4. get_cout_article_famille : coûts détaillés → can_marge_globale
CREATE OR REPLACE FUNCTION public.get_cout_article_famille(_famille text)
 RETURNS TABLE(code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_marge_globale() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.code FROM public.v_gaia_cout_article v WHERE v.famille = _famille;
END; $function$;

-- 5. get_marge_totaux : totaux entreprise → can_marge_globale
CREATE OR REPLACE FUNCTION public.get_marge_totaux(_annee integer)
 RETURNS TABLE(nb_clients integer, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, taux_moyen numeric, couverture numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_marge_globale() THEN
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

-- 6. get_magasin_marge : marge magasin agrégée → can_marge_globale
CREATE OR REPLACE FUNCTION public.get_magasin_marge()
 RETURNS TABLE(annee integer, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, part_reelle numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_marge_globale() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.annee, v.ca_ht, v.ca_avec_cout, v.marge_estimee, v.part_reelle
               FROM public.v_gaia_magasin_marge v;
END; $function$;

-- 7. can_access_dashboard : commercial/chef_ventes ont accès au dashboard par défaut
CREATE OR REPLACE FUNCTION public.can_access_dashboard(_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('admin','direction','chef_ventes','commercial'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND dashboard_enabled = true);
$function$;

-- 8. Grants
GRANT EXECUTE ON FUNCTION public.can_marge_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_marge_globale(uuid) TO authenticated;