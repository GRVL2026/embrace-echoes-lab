
CREATE TABLE public.copilot_user_profiles (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  memoire JSONB NOT NULL DEFAULT '{"notes": []}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_user_profiles TO authenticated;
GRANT ALL ON public.copilot_user_profiles TO service_role;

ALTER TABLE public.copilot_user_profiles ENABLE ROW LEVEL SECURITY;

-- Chaque utilisateur voit et gère uniquement son propre profil copilote
CREATE POLICY "Users manage own copilot profile"
  ON public.copilot_user_profiles
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Les admins peuvent tout voir/gérer
CREATE POLICY "Admins manage all copilot profiles"
  ON public.copilot_user_profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER trg_copilot_user_profiles_updated_at
  BEFORE UPDATE ON public.copilot_user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
