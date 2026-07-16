-- 1) Restrict catalogue_erp reads to direction/admin (like other gaia_* tables)
DROP POLICY IF EXISTS "catalogue_erp_select" ON public.catalogue_erp;
DROP POLICY IF EXISTS "catalogue_erp select" ON public.catalogue_erp;
DROP POLICY IF EXISTS "Authenticated read catalogue_erp" ON public.catalogue_erp;
DROP POLICY IF EXISTS "catalogue_erp read" ON public.catalogue_erp;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT polname FROM pg_policy WHERE polrelid = 'public.catalogue_erp'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.catalogue_erp', r.polname);
  END LOOP;
END $$;
CREATE POLICY "Direction can read catalogue_erp"
  ON public.catalogue_erp FOR SELECT
  TO authenticated
  USING (public.is_direction());

-- 2) Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions that must not be public
REVOKE ALL ON FUNCTION public.gaia_query(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_erp_prices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_allowed_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_dossier_learning() FROM PUBLIC, anon, authenticated;

-- Keep helper role-check functions executable (used by RLS policies)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_direction() TO authenticated;
