CREATE OR REPLACE VIEW public.v_gaia_client_anciennete
WITH (security_invoker = on) AS
WITH lignes AS (
  SELECT
    COALESCE(g.groupe, COALESCE(cl.name, l.code_client)) AS client,
    l.invoice_date,
    EXTRACT(year FROM l.invoice_date + interval '4 months')::int AS exercice
  FROM public.v_gaia_lignes l
  LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
  LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
  WHERE l.invoice_date IS NOT NULL
    AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
),
ex AS (SELECT max(exercice) AS exercice_courant FROM lignes)
SELECT
  l.client,
  min(l.invoice_date) AS premiere_facture,
  max(l.invoice_date) AS derniere_facture,
  min(l.exercice) AS premier_exercice,
  max(l.exercice) AS dernier_exercice_actif,
  max(l.exercice) FILTER (WHERE l.exercice < (SELECT exercice_courant FROM ex) - 1) AS dernier_exercice_avant_courant
FROM lignes l
GROUP BY l.client;

GRANT SELECT ON public.v_gaia_client_anciennete TO authenticated, anon, service_role;