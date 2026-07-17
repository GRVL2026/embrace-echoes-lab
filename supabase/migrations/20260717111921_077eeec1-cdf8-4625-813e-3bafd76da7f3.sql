
-- 1. Column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dashboard_enabled boolean NOT NULL DEFAULT false;

-- 2. Function
CREATE OR REPLACE FUNCTION public.can_access_dashboard(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('admin','direction'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND dashboard_enabled = true);
$$;

GRANT EXECUTE ON FUNCTION public.can_access_dashboard(uuid) TO authenticated;

-- 3. Update SELECT policies for dashboard tables
DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_ventes;
CREATE POLICY "dashboard read" ON public.gaia_ventes FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_historique;
CREATE POLICY "dashboard read" ON public.gaia_historique FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_commandes;
CREATE POLICY "dashboard read" ON public.gaia_commandes FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_stock;
CREATE POLICY "dashboard read" ON public.gaia_stock FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_clients;
CREATE POLICY "dashboard read" ON public.gaia_clients FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_client_groupes;
CREATE POLICY "dashboard read" ON public.gaia_client_groupes FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "gaia direction read" ON public.gaia_sync_log;
CREATE POLICY "dashboard read" ON public.gaia_sync_log FOR SELECT USING (public.can_access_dashboard(auth.uid()));

DROP POLICY IF EXISTS "Direction can read catalogue_erp" ON public.catalogue_erp;
CREATE POLICY "dashboard read" ON public.catalogue_erp FOR SELECT USING (public.can_access_dashboard(auth.uid()));

-- gaia_revues et zendesk restent inchangés (admin+direction).
