
DROP FUNCTION IF EXISTS public.get_reconquete_list();

CREATE OR REPLACE FUNCTION public.get_reconquete_list()
RETURNS TABLE(
  code_client text, nom text, ville text, categorie text, typologie text,
  derniere_commande date, ca_total numeric,
  statut_relance text, statut_relance_maj timestamptz,
  derniere_action_type text, derniere_action_date timestamptz, derniere_action_auteur text,
  score numeric,
  etat_administratif text, procedure_collective boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
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
    SELECT code_client, MAX(invoice_date) AS derniere_commande, COALESCE(SUM(montant_ht),0) AS ca_total
    FROM u WHERE code_client IS NOT NULL GROUP BY code_client
  ),
  last_act AS (
    SELECT DISTINCT ON (a.code_client)
      a.code_client, a.type::text AS type, a.date,
      COALESCE(p.full_name, p.email) AS auteur
    FROM public.client_actions a
    LEFT JOIN public.profiles p ON p.id = a.auteur_id
    ORDER BY a.code_client, a.date DESC
  )
  SELECT
    c.customer_id, c.name, c.ville,
    CASE
      WHEN a.derniere_commande >= CURRENT_DATE - INTERVAL '24 months' THEN 'dormant'
      ELSE 'inactif'
    END,
    c.typologie,
    a.derniere_commande, a.ca_total,
    c.statut_relance::text, c.statut_relance_maj,
    la.type, la.date, la.auteur,
    (a.ca_total * GREATEST(1, EXTRACT(EPOCH FROM (now() - a.derniere_commande::timestamptz)) / 86400.0 / 30.0))::numeric AS score,
    e.etat_administratif,
    COALESCE(e.procedure_collective, false)
  FROM public.gaia_clients c
  JOIN agg a ON a.code_client = c.customer_id
  LEFT JOIN last_act la ON la.code_client = c.customer_id
  LEFT JOIN public.gaia_entreprises e ON e.code_client = c.customer_id
  WHERE a.derniere_commande IS NOT NULL
    AND a.derniere_commande < CURRENT_DATE - INTERVAL '12 months'
    AND COALESCE(c.statut_relance::text, '') <> 'sans_suite'
    AND COALESCE(c.archive, false) = false
  ORDER BY score DESC NULLS LAST
  LIMIT 500;
END;
$function$;
