
DROP FUNCTION IF EXISTS public.get_marge_client(integer);
CREATE OR REPLACE FUNCTION public.get_marge_client(_annee integer DEFAULT NULL, _client text DEFAULT NULL)
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
    WHERE (_annee IS NULL OR v.annee = _annee)
      AND (_client IS NULL OR v.client = _client)
    ORDER BY v.annee DESC, v.ca_ht DESC NULLS LAST;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_marge_client(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_marge_client(integer, text) TO authenticated, service_role;
