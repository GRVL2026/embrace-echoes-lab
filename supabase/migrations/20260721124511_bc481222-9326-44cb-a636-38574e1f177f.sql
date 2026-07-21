ALTER TABLE public.gaia_entreprises
  ADD COLUMN IF NOT EXISTS code_naf text,
  ADD COLUMN IF NOT EXISTS libelle_naf text;