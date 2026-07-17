DROP VIEW IF EXISTS public.v_gaia_pipeline;
CREATE VIEW public.v_gaia_pipeline AS
SELECT
  CASE WHEN order_type = 'QT' THEN 'devis' ELSE 'commande' END AS categorie,
  statut,
  count(DISTINCT n_cde) AS nb,
  COALESCE(sum(montant_ht), 0)::numeric AS total_ht
FROM public.gaia_commandes
WHERE COALESCE(completed, false) = false
  AND statut IN ('Brouillon','Ouvert','Expédition en cours','Reliquat')
GROUP BY 1, 2;

GRANT SELECT ON public.v_gaia_pipeline TO authenticated, service_role;