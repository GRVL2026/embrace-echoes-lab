GRANT SELECT ON public.user_roles, public.profiles TO copilot_readonly;
GRANT EXECUTE ON FUNCTION
  public.is_admin(),
  public.is_direction(),
  public.can_access_dashboard(uuid),
  public.can_reactivation(uuid)
TO copilot_readonly;