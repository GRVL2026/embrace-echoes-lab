
CREATE TABLE public.copilot_alertes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  gravite text NOT NULL CHECK (gravite IN ('info','attention','urgent')),
  titre text NOT NULL,
  constat text NOT NULL,
  action_suggeree text,
  lien text,
  visibilite text NOT NULL DEFAULT 'copilot' CHECK (visibilite IN ('copilot','direction')),
  statut text NOT NULL DEFAULT 'nouveau' CHECK (statut IN ('nouveau','lu','traite','ignore')),
  dedupe_key text NOT NULL UNIQUE,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.copilot_alertes TO authenticated;
GRANT ALL ON public.copilot_alertes TO service_role;
ALTER TABLE public.copilot_alertes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read alertes selon visibilite"
  ON public.copilot_alertes FOR SELECT TO authenticated
  USING (
    visibilite = 'copilot'
    OR (visibilite = 'direction' AND public.is_direction())
  );

CREATE POLICY "Update statut selon visibilite"
  ON public.copilot_alertes FOR UPDATE TO authenticated
  USING (
    visibilite = 'copilot'
    OR (visibilite = 'direction' AND public.is_direction())
  )
  WITH CHECK (
    visibilite = 'copilot'
    OR (visibilite = 'direction' AND public.is_direction())
  );

CREATE INDEX idx_copilot_alertes_statut ON public.copilot_alertes(statut, created_at DESC);
CREATE INDEX idx_copilot_alertes_visibilite ON public.copilot_alertes(visibilite);

CREATE TRIGGER trg_copilot_alertes_updated
  BEFORE UPDATE ON public.copilot_alertes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.copilot_briefings (
  date date PRIMARY KEY,
  contenu jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.copilot_briefings TO authenticated;
GRANT ALL ON public.copilot_briefings TO service_role;
ALTER TABLE public.copilot_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read briefings authentifies"
  ON public.copilot_briefings FOR SELECT TO authenticated
  USING (true);

CREATE TRIGGER trg_copilot_briefings_updated
  BEFORE UPDATE ON public.copilot_briefings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
