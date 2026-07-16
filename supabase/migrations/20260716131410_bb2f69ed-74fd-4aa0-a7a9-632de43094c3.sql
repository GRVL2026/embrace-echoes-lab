
CREATE TABLE IF NOT EXISTS public.shopify_stats_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_stats_cache TO authenticated;
GRANT ALL ON public.shopify_stats_cache TO service_role;
ALTER TABLE public.shopify_stats_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin+direction read stats cache" ON public.shopify_stats_cache
  FOR SELECT TO authenticated USING (public.is_direction());

CREATE TABLE IF NOT EXISTS public.shopify_token_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  shop_domain text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shopify_token_cache TO service_role;
ALTER TABLE public.shopify_token_cache ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated: only service_role can access.

CREATE TRIGGER update_shopify_stats_cache_updated_at
  BEFORE UPDATE ON public.shopify_stats_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shopify_token_cache_updated_at
  BEFORE UPDATE ON public.shopify_token_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
