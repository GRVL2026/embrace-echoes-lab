
-- Restrict brand writes to admins; keep public read.
DROP POLICY IF EXISTS "Public write brands" ON public.brands;
CREATE POLICY "Admins manage brands" ON public.brands
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Lock down SECURITY DEFINER functions from public/anon/authenticated execute.
REVOKE EXECUTE ON FUNCTION public.refresh_erp_prices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_allowed_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_dossier_learning() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_owner_id() FROM PUBLIC, anon, authenticated;
-- is_admin() must remain callable by authenticated (used by RLS policies).
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
