CREATE TABLE public.layout_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL,
  room_geometry JSONB NOT NULL,
  equipment_placements JSONB NOT NULL,
  catalog_used JSONB,
  manual_adjustments BOOLEAN DEFAULT false,
  ai_analysis JSONB,
  room_area_m2 NUMERIC,
  equipment_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.layout_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert layout snapshots"
ON public.layout_snapshots
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can read layout snapshots"
ON public.layout_snapshots
FOR SELECT
USING (true);