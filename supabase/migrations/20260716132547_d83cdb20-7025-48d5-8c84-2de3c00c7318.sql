CREATE TABLE IF NOT EXISTS public.stock_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text,
  cegid_code text,
  shopify_variant_id text,
  qty_before numeric,
  qty_after numeric,
  delta numeric,
  status text NOT NULL,
  message text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stock_sync_log TO authenticated;
GRANT ALL ON public.stock_sync_log TO service_role;

ALTER TABLE public.stock_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read stock sync log"
  ON public.stock_sync_log FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_stock_sync_log_created ON public.stock_sync_log(created_at DESC);