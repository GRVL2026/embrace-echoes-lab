
CREATE TABLE public.zendesk_ticket_summaries (
  ticket_id BIGINT PRIMARY KEY,
  ticket_updated_at TIMESTAMPTZ NOT NULL,
  resume JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.zendesk_ticket_summaries TO authenticated;
GRANT ALL ON public.zendesk_ticket_summaries TO service_role;

ALTER TABLE public.zendesk_ticket_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and direction can read ticket summaries"
  ON public.zendesk_ticket_summaries FOR SELECT
  TO authenticated
  USING (public.is_admin() OR public.is_direction());

CREATE TRIGGER update_zendesk_ticket_summaries_updated_at
  BEFORE UPDATE ON public.zendesk_ticket_summaries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
