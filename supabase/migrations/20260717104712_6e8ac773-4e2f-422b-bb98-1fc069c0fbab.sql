ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS copilote_enabled boolean NOT NULL DEFAULT true;

-- Admins can update the copilote_enabled flag (and other profile fields)
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admins can read all profiles (for user management)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());