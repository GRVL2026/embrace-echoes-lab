CREATE TABLE public.equipment_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id text NOT NULL UNIQUE,
  model_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read equipment_models"
ON public.equipment_models FOR SELECT TO public USING (true);

CREATE POLICY "Public insert equipment_models"
ON public.equipment_models FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Public update equipment_models"
ON public.equipment_models FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "Public delete equipment_models"
ON public.equipment_models FOR DELETE TO public USING (true);