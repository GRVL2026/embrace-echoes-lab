CREATE INDEX IF NOT EXISTS idx_gaia_ventes_code_client ON public.gaia_ventes (code_client);
CREATE INDEX IF NOT EXISTS idx_gaia_historique_code_client ON public.gaia_historique (code_client);

CREATE OR REPLACE FUNCTION public.get_map_points()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  clients_json jsonb;
  prospects_json jsonb;
BEGIN
  IF NOT (public.is_admin() OR public.is_direction()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH union_all AS (
    SELECT code_client, invoice_date, montant_ht FROM public.gaia_ventes
    UNION ALL
    SELECT code_client, invoice_date, montant_ht FROM public.gaia_historique
  ),
  agg AS (
    SELECT
      code_client,
      MAX(invoice_date) AS derniere_commande,
      COALESCE(SUM(montant_ht), 0) AS ca_total,
      COALESCE(SUM(montant_ht) FILTER (WHERE invoice_date >= CURRENT_DATE - INTERVAL '12 months'), 0) AS ca_12m,
      MAX(invoice_date) FILTER (WHERE invoice_date >= CURRENT_DATE - INTERVAL '24 months') AS derniere_24m
    FROM union_all
    WHERE code_client IS NOT NULL
    GROUP BY code_client
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code_client', c.customer_id,
    'nom', c.name,
    'ville', c.ville,
    'lat', c.lat,
    'lng', c.lng,
    'ca_12m', COALESCE(a.ca_12m, 0),
    'ca_total', COALESCE(a.ca_total, 0),
    'derniere_commande', a.derniere_commande,
    'categorie', CASE
      WHEN a.derniere_commande IS NOT NULL AND a.derniere_commande >= CURRENT_DATE - INTERVAL '12 months' THEN 'actif'
      WHEN a.derniere_commande IS NOT NULL AND a.derniere_commande >= CURRENT_DATE - INTERVAL '24 months' THEN 'dormant'
      ELSE 'inactif'
    END
  )), '[]'::jsonb)
  INTO clients_json
  FROM public.gaia_clients c
  LEFT JOIN agg a ON a.code_client = c.customer_id
  WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'nom', p.entreprise,
    'ville', p.ville,
    'lat', p.lat,
    'lng', p.lng,
    'statut', p.statut,
    'segment', p.segment
  )), '[]'::jsonb)
  INTO prospects_json
  FROM public.prospects p
  WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL;

  RETURN jsonb_build_object('clients', clients_json, 'prospects', prospects_json);
END;
$function$;