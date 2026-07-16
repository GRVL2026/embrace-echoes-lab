
CREATE TABLE public.zendesk_stats_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_key TEXT NOT NULL DEFAULT 'default',
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cache_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(period_key, cache_version)
);

GRANT SELECT ON public.zendesk_stats_cache TO authenticated;
GRANT ALL ON public.zendesk_stats_cache TO service_role;

ALTER TABLE public.zendesk_stats_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and direction can read zendesk cache"
  ON public.zendesk_stats_cache FOR SELECT
  TO authenticated
  USING (public.is_admin() OR public.is_direction());

CREATE TRIGGER update_zendesk_stats_cache_updated_at
  BEFORE UPDATE ON public.zendesk_stats_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
