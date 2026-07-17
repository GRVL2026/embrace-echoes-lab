ALTER TABLE public.gaia_stock
  ADD COLUMN IF NOT EXISTS magasin_famille2 text,
  ADD COLUMN IF NOT EXISTS atelier_famille2 text,
  ADD COLUMN IF NOT EXISTS divers_famille2 text;