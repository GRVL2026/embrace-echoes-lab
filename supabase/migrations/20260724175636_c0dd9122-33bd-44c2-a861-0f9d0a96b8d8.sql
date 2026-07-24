ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS lgm_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS lgm_audience TEXT,
  ADD COLUMN IF NOT EXISTS lgm_status TEXT,
  ADD COLUMN IF NOT EXISTS lgm_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_prospects_lgm_lead_id ON public.prospects(lgm_lead_id) WHERE lgm_lead_id IS NOT NULL;