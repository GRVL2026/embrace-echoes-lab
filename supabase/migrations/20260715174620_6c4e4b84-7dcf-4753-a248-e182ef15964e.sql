
-- Nettoyage des tables provisoires (jamais alimentées)
DROP TABLE IF EXISTS public.shipment_documents CASCADE;
DROP TABLE IF EXISTS public.shipment_items CASCADE;
DROP TABLE IF EXISTS public.shipments CASCADE;
DROP TYPE IF EXISTS public.shipment_status;

CREATE TABLE public.logi_expeditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_commande TEXT NOT NULL,
  origine TEXT CHECK (origine IN ('ASIE','US')),
  fournisseur TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  date_dispo_fournisseur DATE,
  port_depart TEXT,
  etd DATE,
  eta_le_havre DATE,
  livraison_aa DATE,
  heure TEXT,
  transitaire TEXT,
  numero_dossier TEXT,
  docs_transmis BOOLEAN NOT NULL DEFAULT false,
  type_conteneur TEXT,
  numero_conteneur TEXT,
  nom_navire TEXT,
  monnayeurs TEXT,
  remarques TEXT,
  cout_fret NUMERIC,
  cout_exw NUMERIC,
  statut TEXT NOT NULL DEFAULT 'a_venir'
    CHECK (statut IN ('livre','en_cours','en_mer','a_venir','en_attente','dispo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.logi_expeditions TO authenticated;
GRANT ALL ON public.logi_expeditions TO service_role;

ALTER TABLE public.logi_expeditions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins only - logi_expeditions"
  ON public.logi_expeditions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER trg_logi_expeditions_updated_at
  BEFORE UPDATE ON public.logi_expeditions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_logi_expeditions_statut ON public.logi_expeditions(statut);
CREATE INDEX idx_logi_expeditions_eta ON public.logi_expeditions(eta_le_havre);
CREATE INDEX idx_logi_expeditions_origine ON public.logi_expeditions(origine);
