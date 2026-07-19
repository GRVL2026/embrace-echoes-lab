ALTER TABLE public.veille_jobs
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS veille_jobs_running_idx ON public.veille_jobs (updated_at DESC) WHERE done = false;