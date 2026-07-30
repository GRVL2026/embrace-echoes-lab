GRANT EXECUTE ON FUNCTION public.can_access_dashboard(uuid) TO copilot_readonly;
GRANT SELECT ON public.user_roles, public.profiles TO copilot_readonly;