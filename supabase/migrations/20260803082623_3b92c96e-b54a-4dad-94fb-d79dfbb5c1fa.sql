-- 1) search_path figé sur la fonction trigger utilitaire
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- 2) Vues matérialisées retirées de l'API Data (usage serveur uniquement)
REVOKE ALL ON public.mv_gaia_resume_mensuel FROM anon, authenticated;
REVOKE ALL ON public.mv_gaia_resume_client_exercice FROM anon, authenticated;
GRANT ALL ON public.mv_gaia_resume_mensuel TO service_role;
GRANT ALL ON public.mv_gaia_resume_client_exercice TO service_role;

-- 3) Fonction trigger SECURITY DEFINER non appelable par les clients
REVOKE ALL ON FUNCTION public.assign_client_owner_on_action() FROM anon, authenticated, public;

-- 4) Empêcher l'auto-attribution des drapeaux d'accès sur profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_flag_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  NEW.dashboard_enabled := OLD.dashboard_enabled;
  NEW.salle_enabled     := OLD.salle_enabled;
  NEW.copilote_enabled  := OLD.copilote_enabled;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.prevent_profile_flag_escalation() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_prevent_profile_flag_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_flag_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_flag_escalation();