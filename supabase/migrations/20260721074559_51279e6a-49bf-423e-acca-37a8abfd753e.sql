CREATE TABLE public.gaia_carnet_snapshot (
  snapshot_date date NOT NULL,
  n_cde text NOT NULL,
  order_type text,
  categorie text,
  statut text,
  code_client text,
  client text,
  total_ht numeric,
  sfa boolean,
  PRIMARY KEY (snapshot_date, n_cde)
);
CREATE INDEX idx_gaia_carnet_snapshot_date ON public.gaia_carnet_snapshot(snapshot_date);
GRANT ALL ON public.gaia_carnet_snapshot TO service_role;
ALTER TABLE public.gaia_carnet_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.gaia_carnet_snapshot FOR ALL USING (false) WITH CHECK (false);