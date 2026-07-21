ALTER TABLE public.gaia_entreprises
  ADD COLUMN IF NOT EXISTS bilans jsonb,
  ADD COLUMN IF NOT EXISTS comptes_publies boolean,
  ADD COLUMN IF NOT EXISTS bilans_maj timestamptz;