
ALTER TABLE public.gaia_commandes ADD COLUMN IF NOT EXISTS proprietaire_id integer;
ALTER TABLE public.gaia_ventes ADD COLUMN IF NOT EXISTS proprietaire_id integer;

CREATE TABLE IF NOT EXISTS public.cegid_users (
  owner_id integer PRIMARY KEY,
  nom text NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cegid_users TO authenticated;
GRANT ALL ON public.cegid_users TO service_role;

ALTER TABLE public.cegid_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cegid_users read authenticated"
  ON public.cegid_users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "cegid_users admin insert"
  ON public.cegid_users FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "cegid_users admin update"
  ON public.cegid_users FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "cegid_users admin delete"
  ON public.cegid_users FOR DELETE
  TO authenticated
  USING (public.is_admin());
