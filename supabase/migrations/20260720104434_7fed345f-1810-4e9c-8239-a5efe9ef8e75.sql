
-- 1) Table invitations_config
CREATE TABLE IF NOT EXISTS public.invitations_config (
  email text PRIMARY KEY,
  salle_enabled boolean NOT NULL DEFAULT false,
  dashboard_enabled boolean NOT NULL DEFAULT false,
  copilote_enabled boolean NOT NULL DEFAULT true,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations_config TO authenticated;
GRANT ALL ON public.invitations_config TO service_role;

ALTER TABLE public.invitations_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage invitations_config" ON public.invitations_config;
CREATE POLICY "Admins manage invitations_config" ON public.invitations_config
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS trg_invitations_config_updated_at ON public.invitations_config;
CREATE TRIGGER trg_invitations_config_updated_at
  BEFORE UPDATE ON public.invitations_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) handle_new_user : consomme invitations_config
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role text;
  inv RECORD;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  SELECT role INTO assigned_role FROM public.allowed_emails WHERE lower(email) = lower(NEW.email);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE(assigned_role, 'commercial'))
  ON CONFLICT DO NOTHING;

  -- Applique les accès pré-configurés (invitations_config) si présents
  SELECT * INTO inv FROM public.invitations_config WHERE lower(email) = lower(NEW.email);
  IF FOUND THEN
    UPDATE public.profiles
      SET salle_enabled = inv.salle_enabled,
          dashboard_enabled = inv.dashboard_enabled,
          copilote_enabled = inv.copilote_enabled
      WHERE id = NEW.id;
    DELETE FROM public.invitations_config WHERE lower(email) = lower(NEW.email);
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Pré-inscription Martin (Salle uniquement)
INSERT INTO public.allowed_emails (email, role)
VALUES ('martin.cibert@hyper-nova.fr', 'commercial')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.invitations_config (email, salle_enabled, dashboard_enabled, copilote_enabled)
VALUES ('martin.cibert@hyper-nova.fr', true, false, false)
ON CONFLICT (email) DO UPDATE SET
  salle_enabled = EXCLUDED.salle_enabled,
  dashboard_enabled = EXCLUDED.dashboard_enabled,
  copilote_enabled = EXCLUDED.copilote_enabled,
  updated_at = now();
