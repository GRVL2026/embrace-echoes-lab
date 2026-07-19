
CREATE TABLE public.veille_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  etape text NOT NULL DEFAULT 'demarrage',
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.veille_jobs TO authenticated;
GRANT ALL ON public.veille_jobs TO service_role;
ALTER TABLE public.veille_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "veille_jobs read admin/direction" ON public.veille_jobs
  FOR SELECT TO authenticated USING (public.is_direction());
CREATE INDEX ON public.veille_jobs (type, started_at DESC);
