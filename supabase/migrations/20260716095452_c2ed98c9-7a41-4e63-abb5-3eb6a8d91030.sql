CREATE TABLE public.veille_rapports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('quotidien','hebdomadaire')),
  periode text NOT NULL,
  contenu_markdown text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.veille_rapports TO authenticated;
GRANT ALL ON public.veille_rapports TO service_role;

ALTER TABLE public.veille_rapports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins et direction peuvent lire les rapports de veille"
ON public.veille_rapports
FOR SELECT
TO authenticated
USING (public.is_admin() OR public.is_direction());

CREATE INDEX idx_veille_rapports_created_at ON public.veille_rapports (created_at DESC);