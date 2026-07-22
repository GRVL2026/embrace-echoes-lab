
-- Allow role to be NULL in allowed_emails (salle-only invites)
ALTER TABLE public.allowed_emails ALTER COLUMN role DROP NOT NULL;

-- Ensure Martin doesn't get resurrected as commercial on any future re-signup
UPDATE public.allowed_emails SET role = NULL WHERE lower(email) = 'martin.cibert@hyper-nova.fr';

-- Update signup handler: only create user_roles when allowed_emails.role is explicitly set.
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
  -- Only assign a role if one was explicitly configured (no default 'commercial')
  IF assigned_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, assigned_role)
    ON CONFLICT DO NOTHING;
  END IF;

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
