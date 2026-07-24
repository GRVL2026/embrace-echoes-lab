ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS pret_a_envoyer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accroche_defaut text,
  ADD COLUMN IF NOT EXISTS prepare_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_prospects_pret_a_envoyer
  ON public.prospects (pret_a_envoyer)
  WHERE pret_a_envoyer = true AND lgm_lead_id IS NULL;