ALTER TABLE public.gaia_clients
  ADD COLUMN IF NOT EXISTS adresse1 text,
  ADD COLUMN IF NOT EXISTS adresse2 text,
  ADD COLUMN IF NOT EXISTS code_postal text,
  ADD COLUMN IF NOT EXISTS ville text,
  ADD COLUMN IF NOT EXISTS pays text;