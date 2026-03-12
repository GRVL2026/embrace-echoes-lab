-- Catalog products table storing Shopify + local data
CREATE TABLE public.catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_id text UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  width numeric NOT NULL DEFAULT 0,
  depth numeric NOT NULL DEFAULT 0,
  height numeric NOT NULL DEFAULT 0,
  safety_zone numeric NOT NULL DEFAULT 10,
  color text,
  icon text,
  pmr_accessible boolean DEFAULT false,
  center_placement boolean DEFAULT false,
  player_clearance numeric,
  model3d text,
  description text,
  vendor text,
  price numeric,
  images text[] DEFAULT '{}',
  video_url text,
  tags text[] DEFAULT '{}',
  warranty text,
  stock text,
  specs jsonb DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read catalog_products"
ON public.catalog_products FOR SELECT TO public USING (true);

CREATE POLICY "Public insert catalog_products"
ON public.catalog_products FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Public update catalog_products"
ON public.catalog_products FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "Public delete catalog_products"
ON public.catalog_products FOR DELETE TO public USING (true);

-- Migrate existing equipment_models data will be handled in app code

-- Drop the old equipment_models table since model3d is now in catalog_products
DROP TABLE IF EXISTS public.equipment_models;