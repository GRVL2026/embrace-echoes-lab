
DROP TABLE IF EXISTS public.cegid_users;

CREATE TABLE public.gaia_equipe (
  contact_id integer PRIMARY KEY,
  nom text,
  login text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.gaia_equipe TO authenticated;
GRANT ALL ON public.gaia_equipe TO service_role;

ALTER TABLE public.gaia_equipe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaia_equipe read authenticated"
  ON public.gaia_equipe FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "gaia_equipe admin write"
  ON public.gaia_equipe FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
