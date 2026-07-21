
CREATE TABLE IF NOT EXISTS public.gaia_entreprises (
  code_client text PRIMARY KEY,
  siren text,
  denomination text,
  forme_juridique text,
  date_creation date,
  effectif_tranche text,
  dirigeants jsonb DEFAULT '[]'::jsonb,
  adresse_siege text,
  etat_administratif text,
  procedure_collective boolean NOT NULL DEFAULT false,
  match_statut text NOT NULL DEFAULT 'introuvable',
  candidats jsonb DEFAULT '[]'::jsonb,
  maj timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.gaia_entreprises TO authenticated;
GRANT ALL ON public.gaia_entreprises TO service_role;

ALTER TABLE public.gaia_entreprises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entreprises_direction_read" ON public.gaia_entreprises;
CREATE POLICY "entreprises_direction_read"
  ON public.gaia_entreprises
  FOR SELECT
  TO authenticated
  USING (public.is_direction());

CREATE INDEX IF NOT EXISTS gaia_entreprises_siren_idx ON public.gaia_entreprises(siren);
CREATE INDEX IF NOT EXISTS gaia_entreprises_match_statut_idx ON public.gaia_entreprises(match_statut);
CREATE INDEX IF NOT EXISTS gaia_entreprises_proc_idx ON public.gaia_entreprises(procedure_collective) WHERE procedure_collective = true;
