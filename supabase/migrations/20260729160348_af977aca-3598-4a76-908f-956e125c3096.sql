REVOKE ALL ON FUNCTION public.gaia_query_restricted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gaia_query_restricted(text) TO authenticated, service_role;