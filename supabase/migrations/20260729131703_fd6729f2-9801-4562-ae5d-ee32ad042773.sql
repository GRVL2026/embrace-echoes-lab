
ALTER TABLE public.gaia_clients ADD COLUMN IF NOT EXISTS telephone text;

CREATE OR REPLACE FUNCTION public.get_client_reactivation(_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  client_row RECORD;
  actions_json jsonb;
  familles_json jsonb;
  produits_json jsonb;
  last_action_json jsonb;
  last_order date;
  ca_total numeric;
  owner_name text;
BEGIN
  IF NOT public.can_reactivation() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT c.customer_id, c.name, c.statut_relance::text AS statut_relance,
         c.statut_relance_maj, c.email, c.telephone, c.owner_id, c.ville, c.typologie,
         c.adresse1, c.adresse2, c.code_postal, c.pays
  INTO client_row
  FROM public.gaia_clients c
  WHERE c.customer_id = _code;

  SELECT COALESCE(p.full_name, p.email) INTO owner_name
  FROM public.profiles p WHERE p.id = client_row.owner_id;

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

  SELECT to_jsonb(y) INTO last_action_json
  FROM (
    SELECT a.type::text AS type, a.date, COALESCE(p.full_name, p.email) AS auteur
    FROM public.client_actions a
    LEFT JOIN public.profiles p ON p.id = a.auteur_id
    WHERE a.code_client = _code
    ORDER BY a.date DESC
    LIMIT 1
  ) y;

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
    'telephone', client_row.telephone,
    'adresse1', client_row.adresse1,
    'adresse2', client_row.adresse2,
    'code_postal', client_row.code_postal,
    'pays', client_row.pays,
    'owner_id', client_row.owner_id,
    'owner_nom', owner_name,
    'statut_relance', client_row.statut_relance,
    'statut_relance_maj', client_row.statut_relance_maj,
    'derniere_commande', last_order,
    'ca_total', ca_total,
    'derniere_action', last_action_json,
    'familles', familles_json,
    'produits_recents', produits_json,
    'actions', actions_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_reactivation(text) TO authenticated;
