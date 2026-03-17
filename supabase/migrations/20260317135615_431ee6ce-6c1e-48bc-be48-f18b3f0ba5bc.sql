
-- Create external_asset_sources table
CREATE TABLE public.external_asset_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'sketchfab',
  provider_asset_id text NOT NULL,
  provider_url text,
  license_type text,
  download_format text DEFAULT 'glb',
  original_metadata jsonb DEFAULT '{}'::jsonb,
  source_user text,
  downloaded_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_asset_id)
);

ALTER TABLE public.external_asset_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read external_asset_sources" ON public.external_asset_sources FOR SELECT TO public USING (true);
CREATE POLICY "Public insert external_asset_sources" ON public.external_asset_sources FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public update external_asset_sources" ON public.external_asset_sources FOR UPDATE TO public USING (true) WITH CHECK (true);

-- Extend copilot_assets with missing columns
ALTER TABLE public.copilot_assets 
  ADD COLUMN IF NOT EXISTS polycount integer,
  ADD COLUMN IF NOT EXISTS file_size_mb numeric,
  ADD COLUMN IF NOT EXISTS license_ok boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_curated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_provider text,
  ADD COLUMN IF NOT EXISTS provider_asset_id text;
