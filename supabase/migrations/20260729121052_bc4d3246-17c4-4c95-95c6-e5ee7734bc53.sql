
-- 1. Helper: qui peut travailler la réactivation
CREATE OR REPLACE FUNCTION public.can_reactivation(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_admin()
    OR public.is_direction()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = _uid
        AND lower(email) IN (
          'romain.lirola@avranchesautomatic.com',
          'valerie@avranchesautomatic.com'
        )
    );
$$;
GRANT EXECUTE ON FUNCTION public.can_reactivation(uuid) TO authenticated;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE public.statut_relance_enum AS ENUM ('a_contacter','contacte','relance','reactive','sans_suite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.action_type_enum AS ENUM ('mail','appel','visite','note','autre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Colonne statut_relance sur gaia_clients + policy UPDATE ciblée
ALTER TABLE public.gaia_clients
  ADD COLUMN IF NOT EXISTS statut_relance public.statut_relance_enum,
  ADD COLUMN IF NOT EXISTS statut_relance_maj timestamptz,
  ADD COLUMN IF NOT EXISTS statut_relance_par uuid;

GRANT UPDATE (statut_relance, statut_relance_maj, statut_relance_par)
  ON public.gaia_clients TO authenticated;

DROP POLICY IF EXISTS "reactivation_update_statut" ON public.gaia_clients;
CREATE POLICY "reactivation_update_statut"
  ON public.gaia_clients
  FOR UPDATE
  TO authenticated
  USING (public.can_reactivation())
  WITH CHECK (public.can_reactivation());

-- 4. Table client_actions
CREATE TABLE IF NOT EXISTS public.client_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_client text NOT NULL,
  auteur_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  type public.action_type_enum NOT NULL,
  date timestamptz NOT NULL DEFAULT now(),
  contenu text NOT NULL,
  resultat text,
  prochaine_relance date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_actions_code_date
  ON public.client_actions (code_client, date DESC);
CREATE INDEX IF NOT EXISTS idx_client_actions_prochaine
  ON public.client_actions (prochaine_relance) WHERE prochaine_relance IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_actions TO authenticated;
GRANT ALL ON public.client_actions TO service_role;

ALTER TABLE public.client_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_actions_select" ON public.client_actions;
CREATE POLICY "client_actions_select"
  ON public.client_actions FOR SELECT
  TO authenticated
  USING (public.can_reactivation());

DROP POLICY IF EXISTS "client_actions_insert" ON public.client_actions;
CREATE POLICY "client_actions_insert"
  ON public.client_actions FOR INSERT
  TO authenticated
  WITH CHECK (public.can_reactivation() AND auteur_id = auth.uid());

DROP POLICY IF EXISTS "client_actions_update_own" ON public.client_actions;
CREATE POLICY "client_actions_update_own"
  ON public.client_actions FOR UPDATE
  TO authenticated
  USING (public.can_reactivation() AND (auteur_id = auth.uid() OR public.is_admin() OR public.is_direction()))
  WITH CHECK (public.can_reactivation());

DROP POLICY IF EXISTS "client_actions_delete_own" ON public.client_actions;
CREATE POLICY "client_actions_delete_own"
  ON public.client_actions FOR DELETE
  TO authenticated
  USING (public.is_admin() OR public.is_direction() OR (public.can_reactivation() AND auteur_id = auth.uid()));

-- 5. Liste À RELANCER (dormants + inactifs) triée par CA × ancienneté
CREATE OR REPLACE FUNCTION public.get_reconquete_list()
RETURNS TABLE(
  code_client text,
  nom text,
  ville text,
  categorie text,
  typologie text,
  derniere_commande date,
  ca_total numeric,
  statut_relance text,
  statut_relance_maj timestamptz,
  derniere_action_type text,
  derniere_action_date timestamptz,
  derniere_action_auteur text,
  score numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_reactivation() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH u AS (
    SELECT code_client, invoice_date, montant_ht FROM public.gaia_ventes
    UNION ALL
    SELECT code_client, invoice_date, montant_ht FROM public.gaia_historique
  ),
  agg AS (
    SELECT
      code_client,
      MAX(invoice_date) AS derniere_commande,
      COALESCE(SUM(montant_ht),0) AS ca_total
    FROM u
    WHERE code_client IS NOT NULL
    GROUP BY code_client
  ),
  last_act AS (
    SELECT DISTINCT ON (a.code_client)
      a.code_client,
      a.type::text AS type,
      a.date,
      COALESCE(p.full_name, p.email) AS auteur
    FROM public.client_actions a
    LEFT JOIN public.profiles p ON p.id = a.auteur_id
    ORDER BY a.code_client, a.date DESC
  )
  SELECT
    c.customer_id,
    c.name,
    c.ville,
    CASE
      WHEN a.derniere_commande >= CURRENT_DATE - INTERVAL '24 months' THEN 'dormant'
      ELSE 'inactif'
    END,
    c.typologie,
    a.derniere_commande,
    a.ca_total,
    c.statut_relance::text,
    c.statut_relance_maj,
    la.type,
    la.date,
    la.auteur,
    (a.ca_total * GREATEST(1, EXTRACT(EPOCH FROM (now() - a.derniere_commande::timestamptz)) / 86400.0 / 30.0))::numeric AS score
  FROM public.gaia_clients c
  JOIN agg a ON a.code_client = c.customer_id
  LEFT JOIN last_act la ON la.code_client = c.customer_id
  WHERE a.derniere_commande IS NOT NULL
    AND a.derniere_commande < CURRENT_DATE - INTERVAL '12 months'
    AND COALESCE(c.statut_relance::text, '') <> 'sans_suite'
  ORDER BY score DESC NULLS LAST
  LIMIT 500;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_reconquete_list() TO authenticated;

-- 6. Détail réactivation d'un client (popup carte + fiche)
CREATE OR REPLACE FUNCTION public.get_client_reactivation(_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  client_row RECORD;
  actions_json jsonb;
BEGIN
  IF NOT public.can_reactivation() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT c.customer_id, c.name, c.statut_relance::text AS statut_relance, c.statut_relance_maj
  INTO client_row
  FROM public.gaia_clients c
  WHERE c.customer_id = _code;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.date DESC), '[]'::jsonb)
  INTO actions_json
  FROM (
    SELECT a.id, a.type::text AS type, a.date, a.contenu, a.resultat, a.prochaine_relance,
           COALESCE(p.full_name, p.email) AS auteur
    FROM public.client_actions a
    LEFT JOIN public.profiles p ON p.id = a.auteur_id
    WHERE a.code_client = _code
    ORDER BY a.date DESC
    LIMIT 20
  ) x;

  RETURN jsonb_build_object(
    'code_client', client_row.customer_id,
    'nom', client_row.name,
    'statut_relance', client_row.statut_relance,
    'statut_relance_maj', client_row.statut_relance_maj,
    'actions', actions_json
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_client_reactivation(text) TO authenticated;
