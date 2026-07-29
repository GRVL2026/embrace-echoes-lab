ALTER TABLE public.gaia_clients ADD COLUMN IF NOT EXISTS lat numeric;
ALTER TABLE public.gaia_clients ADD COLUMN IF NOT EXISTS lng numeric;
ALTER TABLE public.gaia_clients ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS lat numeric;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS lng numeric;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_gaia_clients_latlng ON public.gaia_clients(lat, lng) WHERE lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_latlng ON public.prospects(lat, lng) WHERE lat IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_map_points()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clients_json jsonb;
  prospects_json jsonb;
BEGIN
  IF NOT (public.is_admin() OR public.is_direction()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ca AS (
    SELECT code_client, SUM(montant_ht) AS ca_12m, MAX(invoice_date) AS derniere
    FROM public.gaia_ventes
    WHERE invoice_date >= (CURRENT_DATE - INTERVAL '24 months')
    GROUP BY code_client
  ),
  ca_all AS (
    SELECT code_client, MAX(invoice_date) AS derniere_all
    FROM public.gaia_ventes
    GROUP BY code_client
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code_client', c.customer_id,
    'nom', c.name,
    'ville', c.ville,
    'lat', c.lat,
    'lng', c.lng,
    'ca_12m', COALESCE(ca.ca_12m, 0),
    'categorie', CASE
      WHEN ca.derniere IS NOT NULL AND ca.derniere >= CURRENT_DATE - INTERVAL '12 months' THEN 'actif'
      WHEN ca.derniere IS NOT NULL AND ca.derniere >= CURRENT_DATE - INTERVAL '24 months' THEN 'dormant'
      ELSE 'inactif'
    END
  )), '[]'::jsonb)
  INTO clients_json
  FROM public.gaia_clients c
  LEFT JOIN ca ON ca.code_client = c.customer_id
  LEFT JOIN ca_all ON ca_all.code_client = c.customer_id
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
$$;

GRANT EXECUTE ON FUNCTION public.get_map_points() TO authenticated;