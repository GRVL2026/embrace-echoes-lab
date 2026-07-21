
-- 1. Fix Security Definer View: set security_invoker on v_gaia_parc_client
ALTER VIEW public.v_gaia_parc_client SET (security_invoker = on);

-- 2. Revoke EXECUTE from anon on all SECURITY DEFINER functions in public
REVOKE EXECUTE ON FUNCTION public.can_access_dashboard(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_salle(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cegid_sync_try_lock(integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_notification_prefs(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_direction() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_notification(text, text, text, text, text, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, text, text, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gaia_query(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_erp_prices() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.capture_dossier_learning() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_allowed_email() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- Keep authenticated EXECUTE for RLS helper functions (required by RLS policies)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_direction() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_salle(uuid) TO authenticated;

-- Service role keeps full access
GRANT EXECUTE ON FUNCTION public.cegid_sync_try_lock(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_notification_prefs(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_notification(text, text, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gaia_query(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_erp_prices() TO service_role;
