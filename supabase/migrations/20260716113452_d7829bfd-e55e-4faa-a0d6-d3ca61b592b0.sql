
ALTER TABLE public.gaia_revues
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'terminee',
  ADD COLUMN IF NOT EXISTS erreur text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.gaia_revues ALTER COLUMN data DROP NOT NULL;

CREATE INDEX IF NOT EXISTS gaia_revues_statut_idx ON public.gaia_revues(statut, created_at DESC);
