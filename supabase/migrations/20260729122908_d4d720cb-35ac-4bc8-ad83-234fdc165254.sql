
CREATE TABLE public.user_menu_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (user_id, section_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_menu_access TO authenticated;
GRANT ALL ON public.user_menu_access TO service_role;

ALTER TABLE public.user_menu_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own_or_admin"
  ON public.user_menu_access FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "admin_insert"
  ON public.user_menu_access FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_update"
  ON public.user_menu_access FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_delete"
  ON public.user_menu_access FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE INDEX idx_user_menu_access_user ON public.user_menu_access(user_id);
