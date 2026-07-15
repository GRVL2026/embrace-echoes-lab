
CREATE TYPE public.shipment_status AS ENUM ('a_venir','dispo','en_attente','en_cours','en_mer','livre');

CREATE TABLE public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  supplier TEXT NOT NULL,
  origin_country TEXT,
  carrier TEXT,
  tracking_number TEXT,
  status public.shipment_status NOT NULL DEFAULT 'a_venir',
  order_date DATE,
  factory_departure_date DATE,
  eta_date DATE,
  arrival_date DATE,
  amount_ht NUMERIC(12,2),
  currency TEXT DEFAULT 'EUR',
  incoterm TEXT,
  customs_fees NUMERIC(12,2),
  transport_fees NUMERIC(12,2),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access shipments" ON public.shipments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER trg_shipments_updated_at BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_shipments_status ON public.shipments(status);
CREATE INDEX idx_shipments_eta ON public.shipments(eta_date);

CREATE TABLE public.shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_items TO authenticated;
GRANT ALL ON public.shipment_items TO service_role;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access shipment_items" ON public.shipment_items
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE INDEX idx_shipment_items_shipment ON public.shipment_items(shipment_id);

CREATE TABLE public.shipment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT,
  file_path TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_documents TO authenticated;
GRANT ALL ON public.shipment_documents TO service_role;
ALTER TABLE public.shipment_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access shipment_documents" ON public.shipment_documents
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE INDEX idx_shipment_documents_shipment ON public.shipment_documents(shipment_id);

CREATE POLICY "Admins read shipment docs" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'shipment-docs' AND public.is_admin());
CREATE POLICY "Admins upload shipment docs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'shipment-docs' AND public.is_admin());
CREATE POLICY "Admins update shipment docs" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'shipment-docs' AND public.is_admin());
CREATE POLICY "Admins delete shipment docs" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'shipment-docs' AND public.is_admin());
