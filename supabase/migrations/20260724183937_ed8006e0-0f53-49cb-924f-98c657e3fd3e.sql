
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS siret text,
  ADD COLUMN IF NOT EXISTS adresse text,
  ADD COLUMN IF NOT EXISTS effectif text,
  ADD COLUMN IF NOT EXISTS ca_annuel numeric,
  ADD COLUMN IF NOT EXISTS activite text,
  ADD COLUMN IF NOT EXISTS site_web text;
