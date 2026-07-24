CREATE TABLE public.lgm_webhook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  event text,
  lgm_lead_id text,
  matched_prospect uuid,
  action text
);

GRANT SELECT ON public.lgm_webhook_log TO authenticated;
GRANT ALL ON public.lgm_webhook_log TO service_role;

ALTER TABLE public.lgm_webhook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_direction_read_lgm_webhook_log"
ON public.lgm_webhook_log FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_direction());

CREATE INDEX idx_lgm_webhook_log_lead ON public.lgm_webhook_log(lgm_lead_id);
CREATE INDEX idx_lgm_webhook_log_received ON public.lgm_webhook_log(received_at DESC);