
-- =============================================
-- COPILOT V1 — Tables de données
-- =============================================

-- 1. Assets décoratifs (objets 3D pour le copilote)
CREATE TABLE public.copilot_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT '',
  subcategory TEXT,
  asset_type TEXT NOT NULL DEFAULT 'decor',
  format TEXT NOT NULL DEFAULT 'glb',
  style_tags TEXT[] DEFAULT '{}',
  material_tags TEXT[] DEFAULT '{}',
  color_tags TEXT[] DEFAULT '{}',
  room_tags TEXT[] DEFAULT '{}',
  dimensions NUMERIC[] DEFAULT '{1,1,1}',
  bounding_box NUMERIC[] DEFAULT '{1,1,1}',
  scale_default NUMERIC[] DEFAULT '{1,1,1}',
  rotation_default NUMERIC[] DEFAULT '{0,0,0}',
  file_url TEXT,
  thumbnail_url TEXT,
  preview_url TEXT,
  license TEXT DEFAULT 'unknown',
  source TEXT DEFAULT 'internal',
  performance_tier TEXT DEFAULT 'light',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read copilot_assets"
  ON public.copilot_assets FOR SELECT
  USING (true);

CREATE POLICY "Public insert copilot_assets"
  ON public.copilot_assets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update copilot_assets"
  ON public.copilot_assets FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Public delete copilot_assets"
  ON public.copilot_assets FOR DELETE
  USING (true);

-- Index pour recherche par tags
CREATE INDEX idx_copilot_assets_style_tags ON public.copilot_assets USING GIN(style_tags);
CREATE INDEX idx_copilot_assets_material_tags ON public.copilot_assets USING GIN(material_tags);
CREATE INDEX idx_copilot_assets_color_tags ON public.copilot_assets USING GIN(color_tags);

-- 2. Textures / Matériaux référencés par le copilote
CREATE TABLE public.copilot_textures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  texture_type TEXT NOT NULL DEFAULT 'generic',
  source TEXT NOT NULL DEFAULT 'polyhaven',
  polyhaven_id TEXT,
  albedo_url TEXT,
  normal_url TEXT,
  roughness_url TEXT,
  metalness_url TEXT,
  style_tags TEXT[] DEFAULT '{}',
  color_tags TEXT[] DEFAULT '{}',
  room_usage TEXT[] DEFAULT '{}',
  repeat_scale NUMERIC DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_textures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read copilot_textures"
  ON public.copilot_textures FOR SELECT
  USING (true);

CREATE POLICY "Public insert copilot_textures"
  ON public.copilot_textures FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update copilot_textures"
  ON public.copilot_textures FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Public delete copilot_textures"
  ON public.copilot_textures FOR DELETE
  USING (true);

CREATE INDEX idx_copilot_textures_style_tags ON public.copilot_textures USING GIN(style_tags);
CREATE INDEX idx_copilot_textures_polyhaven_id ON public.copilot_textures (polyhaven_id);

-- 3. Sessions de conversation du copilote
CREATE TABLE public.prompt_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  current_style JSONB,
  locked_elements JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.prompt_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read prompt_sessions"
  ON public.prompt_sessions FOR SELECT
  USING (true);

CREATE POLICY "Public insert prompt_sessions"
  ON public.prompt_sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update prompt_sessions"
  ON public.prompt_sessions FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Public delete prompt_sessions"
  ON public.prompt_sessions FOR DELETE
  USING (true);

-- 4. Révisions de scène (snapshots)
CREATE TABLE public.scene_revisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.prompt_sessions(id) ON DELETE CASCADE NOT NULL,
  scene_snapshot JSONB,
  generated_summary TEXT,
  asset_list JSONB DEFAULT '[]',
  placement_data JSONB DEFAULT '[]',
  actions_applied JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scene_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read scene_revisions"
  ON public.scene_revisions FOR SELECT
  USING (true);

CREATE POLICY "Public insert scene_revisions"
  ON public.scene_revisions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update scene_revisions"
  ON public.scene_revisions FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Public delete scene_revisions"
  ON public.scene_revisions FOR DELETE
  USING (true);

CREATE INDEX idx_scene_revisions_session ON public.scene_revisions (session_id);

-- Trigger pour updated_at automatique
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_copilot_assets_updated_at
  BEFORE UPDATE ON public.copilot_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_copilot_textures_updated_at
  BEFORE UPDATE ON public.copilot_textures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_prompt_sessions_updated_at
  BEFORE UPDATE ON public.prompt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
