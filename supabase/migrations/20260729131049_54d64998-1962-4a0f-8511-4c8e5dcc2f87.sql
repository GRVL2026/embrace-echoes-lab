-- 1) Nouvelles colonnes
ALTER TABLE public.gaia_clients
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gaia_clients_owner ON public.gaia_clients(owner_id);

-- 2) RLS : permettre à can_reactivation() de mettre à jour la fiche client
--    (owner_id, statut_relance, email en fallback)
DROP POLICY IF EXISTS gaia_clients_update_reactivation ON public.gaia_clients;
CREATE POLICY gaia_clients_update_reactivation
ON public.gaia_clients
FOR UPDATE
TO authenticated
USING (public.can_reactivation())
WITH CHECK (public.can_reactivation());

-- 3) Trigger : à chaque insert dans client_actions, si le client n'a pas de owner,
--    on l'attribue à l'auteur de l'action.
CREATE OR REPLACE FUNCTION public.assign_client_owner_on_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.gaia_clients
  SET owner_id = NEW.auteur_id
  WHERE customer_id = NEW.code_client
    AND owner_id IS NULL
    AND NEW.auteur_id IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_client_owner ON public.client_actions;
CREATE TRIGGER trg_assign_client_owner
AFTER INSERT ON public.client_actions
FOR EACH ROW EXECUTE FUNCTION public.assign_client_owner_on_action();

-- 4) RPC enrichie : email, owner, familles récemment achetées
CREATE OR REPLACE FUNCTION public.get_client_reactivation(_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  client_row RECORD;
  actions_json jsonb;
  familles_json jsonb;
  produits_json jsonb;
  last_order date;
  ca_total numeric;
  owner_name text;
BEGIN
  IF NOT public.can_reactivation() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT c.customer_id, c.name, c.statut_relance::text AS statut_relance,
         c.statut_relance_maj, c.email, c.owner_id, c.ville, c.typologie
  INTO client_row
  FROM public.gaia_clients c
  WHERE c.customer_id = _code;

  SELECT COALESCE(p.full_name, p.email) INTO owner_name
  FROM public.profiles p WHERE p.id = client_row.owner_id;

  -- Historique actions
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

  -- Union ventes + historique pour familles récentes et CA total
  WITH lignes AS (
    SELECT invoice_date, classe_article, code_article, montant_ht
    FROM public.gaia_ventes WHERE code_client = _code
    UNION ALL
    SELECT invoice_date, classe_article, code_article, montant_ht
    FROM public.gaia_historique WHERE code_client = _code
  )
  SELECT MAX(invoice_date), COALESCE(SUM(montant_ht), 0) INTO last_order, ca_total FROM lignes;

  SELECT COALESCE(jsonb_agg(f ORDER BY f.ca DESC), '[]'::jsonb)
  INTO familles_json
  FROM (
    SELECT classe_article AS famille, SUM(montant_ht) AS ca
    FROM (
      SELECT classe_article, montant_ht FROM public.gaia_ventes WHERE code_client = _code
      UNION ALL
      SELECT classe_article, montant_ht FROM public.gaia_historique WHERE code_client = _code
    ) u
    WHERE classe_article IS NOT NULL
    GROUP BY classe_article
    ORDER BY SUM(montant_ht) DESC
    LIMIT 6
  ) f;

  -- 8 derniers produits achetés
  SELECT COALESCE(jsonb_agg(p ORDER BY p.d DESC), '[]'::jsonb)
  INTO produits_json
  FROM (
    SELECT DISTINCT ON (u.code_article)
      u.code_article AS code,
      COALESCE(ce.description, u.code_article) AS libelle,
      u.invoice_date AS d
    FROM (
      SELECT invoice_date, code_article FROM public.gaia_ventes WHERE code_client = _code AND code_article IS NOT NULL
      UNION ALL
      SELECT invoice_date, code_article FROM public.gaia_historique WHERE code_client = _code AND code_article IS NOT NULL
    ) u
    LEFT JOIN public.catalogue_erp ce ON ce.code = u.code_article
    ORDER BY u.code_article, u.invoice_date DESC
    LIMIT 8
  ) p;

  RETURN jsonb_build_object(
    'code_client', client_row.customer_id,
    'nom', client_row.name,
    'ville', client_row.ville,
    'typologie', client_row.typologie,
    'email', client_row.email,
    'owner_id', client_row.owner_id,
    'owner_nom', owner_name,
    'statut_relance', client_row.statut_relance,
    'statut_relance_maj', client_row.statut_relance_maj,
    'derniere_commande', last_order,
    'ca_total', ca_total,
    'familles', familles_json,
    'produits_recents', produits_json,
    'actions', actions_json
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_client_reactivation(text) TO authenticated;