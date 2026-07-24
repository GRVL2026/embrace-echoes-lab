
CREATE OR REPLACE FUNCTION public.can_access_prospection(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin','direction','prospection')
  );
$$;

DROP POLICY IF EXISTS "prospects direction all" ON public.prospects;
CREATE POLICY "prospects prospection all" ON public.prospects
  FOR ALL TO authenticated
  USING (public.can_access_prospection())
  WITH CHECK (public.can_access_prospection());

DROP POLICY IF EXISTS "prospect_events direction all" ON public.prospect_events;
CREATE POLICY "prospect_events prospection all" ON public.prospect_events
  FOR ALL TO authenticated
  USING (public.can_access_prospection())
  WITH CHECK (public.can_access_prospection());

DROP POLICY IF EXISTS "admin_direction_read_lgm_webhook_log" ON public.lgm_webhook_log;
CREATE POLICY "prospection_read_lgm_webhook_log" ON public.lgm_webhook_log
  FOR SELECT TO authenticated
  USING (public.can_access_prospection());
