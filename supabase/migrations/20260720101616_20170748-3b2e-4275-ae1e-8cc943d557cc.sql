
-- 1) Drapeau accès Salle Hyper Nova
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS salle_enabled boolean NOT NULL DEFAULT false;

-- 2) Helper : accès Salle (admin/direction OU flag explicite)
CREATE OR REPLACE FUNCTION public.can_access_salle(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('admin','direction'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND salle_enabled = true);
$$;

-- 3) Journées de salle
CREATE TABLE IF NOT EXISTS public.salle_journees (
  date                     date PRIMARY KEY,
  visiteurs                integer NOT NULL DEFAULT 0,
  nb_parties               integer NOT NULL DEFAULT 0,
  nb_cartes_vendues        integer NOT NULL DEFAULT 0,
  ca_cartes_ht             numeric(12,2) NOT NULL DEFAULT 0,
  ca_pax_ht                numeric(12,2) NOT NULL DEFAULT 0,
  ca_merch_ht              numeric(12,2) NOT NULL DEFAULT 0,
  ca_vending_pokemon_ht    numeric(12,2) NOT NULL DEFAULT 0,
  ca_vending_blindbox_ht   numeric(12,2) NOT NULL DEFAULT 0,
  ca_photomaton_ht         numeric(12,2) NOT NULL DEFAULT 0,
  notes                    text,
  saisi_par                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salle_journees TO authenticated;
GRANT ALL ON public.salle_journees TO service_role;

ALTER TABLE public.salle_journees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salle journees lecture" ON public.salle_journees
  FOR SELECT TO authenticated USING (public.can_access_salle(auth.uid()));
CREATE POLICY "salle journees insert" ON public.salle_journees
  FOR INSERT TO authenticated WITH CHECK (public.can_access_salle(auth.uid()));
CREATE POLICY "salle journees update" ON public.salle_journees
  FOR UPDATE TO authenticated USING (public.can_access_salle(auth.uid())) WITH CHECK (public.can_access_salle(auth.uid()));
CREATE POLICY "salle journees delete" ON public.salle_journees
  FOR DELETE TO authenticated USING (public.can_access_salle(auth.uid()));

CREATE TRIGGER trg_salle_journees_updated
BEFORE UPDATE ON public.salle_journees
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Objectifs
CREATE TABLE IF NOT EXISTS public.salle_objectifs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_debut            date NOT NULL,
  date_fin              date,
  objectif_jour_ht      numeric(12,2) NOT NULL,
  objectif_semaine_ht   numeric(12,2) NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salle_objectifs TO authenticated;
GRANT ALL ON public.salle_objectifs TO service_role;

ALTER TABLE public.salle_objectifs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salle objectifs lecture" ON public.salle_objectifs
  FOR SELECT TO authenticated USING (public.can_access_salle(auth.uid()));
CREATE POLICY "salle objectifs insert" ON public.salle_objectifs
  FOR INSERT TO authenticated WITH CHECK (public.can_access_salle(auth.uid()));
CREATE POLICY "salle objectifs update" ON public.salle_objectifs
  FOR UPDATE TO authenticated USING (public.can_access_salle(auth.uid())) WITH CHECK (public.can_access_salle(auth.uid()));
CREATE POLICY "salle objectifs delete" ON public.salle_objectifs
  FOR DELETE TO authenticated USING (public.can_access_salle(auth.uid()));

CREATE TRIGGER trg_salle_objectifs_updated
BEFORE UPDATE ON public.salle_objectifs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial
INSERT INTO public.salle_objectifs (date_debut, date_fin, objectif_jour_ht, objectif_semaine_ht)
VALUES ('2026-01-01', NULL, 2881, 20167)
ON CONFLICT DO NOTHING;
