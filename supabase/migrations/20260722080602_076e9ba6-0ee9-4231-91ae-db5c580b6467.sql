
CREATE OR REPLACE FUNCTION public.refresh_gaia_resumes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Autorise soit le service_role (synchro nocturne), soit direction/admin (bouton manuel).
  IF auth.role() <> 'service_role' AND NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
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

GRANT EXECUTE ON FUNCTION public.refresh_gaia_resumes() TO authenticated;
