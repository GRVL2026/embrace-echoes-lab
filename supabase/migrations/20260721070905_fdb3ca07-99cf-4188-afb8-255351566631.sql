
CREATE POLICY "Admins can read sync state"
ON public.cegid_sync_state
FOR SELECT
TO authenticated
USING (public.is_admin());

GRANT SELECT ON public.cegid_sync_state TO authenticated;
