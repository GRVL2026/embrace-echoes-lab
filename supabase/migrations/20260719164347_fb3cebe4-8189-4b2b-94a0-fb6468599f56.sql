
-- 1) allowed_emails : politique admin explicite (aucun accès pour les autres)
DROP POLICY IF EXISTS "allowed_emails admin only" ON public.allowed_emails;
CREATE POLICY "allowed_emails admin only"
  ON public.allowed_emails
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
REVOKE ALL ON public.allowed_emails FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_emails TO authenticated;
GRANT ALL ON public.allowed_emails TO service_role;

-- 2) shopify_token_cache : jamais accessible côté client (uniquement service_role)
DROP POLICY IF EXISTS "shopify_token_cache no client access" ON public.shopify_token_cache;
CREATE POLICY "shopify_token_cache no client access"
  ON public.shopify_token_cache
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
REVOKE ALL ON public.shopify_token_cache FROM anon, authenticated;
GRANT ALL ON public.shopify_token_cache TO service_role;

-- 3) gaia_config : refus explicite pour anon
DROP POLICY IF EXISTS "gaia_config deny anon" ON public.gaia_config;
CREATE POLICY "gaia_config deny anon"
  ON public.gaia_config
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
REVOKE ALL ON public.gaia_config FROM anon;

-- 4) SECURITY DEFINER : verrouiller l'exécution
-- Fonctions internes / admin uniquement : retirer EXECUTE pour anon + authenticated
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_allowed_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_dossier_learning() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_erp_prices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gaia_query(text) FROM PUBLIC, anon, authenticated;

-- Fonctions utilisées dans les politiques RLS : retirer anon uniquement,
-- garder authenticated pour que l'évaluation des policies fonctionne.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_direction() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_direction() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_dashboard(uuid) TO authenticated;
