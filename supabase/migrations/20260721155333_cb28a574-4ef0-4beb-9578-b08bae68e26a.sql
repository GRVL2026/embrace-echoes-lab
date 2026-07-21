
CREATE OR REPLACE VIEW public.v_gaia_client_anciennete
WITH (security_invoker = on) AS
SELECT
  COALESCE(max(g.groupe), max(COALESCE(cl.name, l.code_client))) AS client,
  min(l.invoice_date) AS premiere_facture,
  max(l.invoice_date) AS derniere_facture,
  (EXTRACT(year FROM min(l.invoice_date) + interval '4 mons'))::int AS premier_exercice,
  (EXTRACT(year FROM max(l.invoice_date) + interval '4 mons'))::int AS dernier_exercice_actif
FROM public.v_gaia_lignes l
LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
WHERE l.invoice_date IS NOT NULL
  AND NOT (l.code_article IN (SELECT code FROM public.v_gaia_ecotax_codes))
GROUP BY COALESCE(g.groupe, l.code_client);

GRANT SELECT ON public.v_gaia_client_anciennete TO authenticated, anon, service_role;
