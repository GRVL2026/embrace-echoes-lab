-- Ensure is_direction() exists (idempotent safety)
CREATE OR REPLACE FUNCTION public.is_direction()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','direction')
  );
$$;

-- Non-sensitive article -> famille lookup (no cost, no gate)
CREATE OR REPLACE VIEW public.v_gaia_article_famille
WITH (security_invoker=on) AS
SELECT
  trim(inventory_id) AS code,
  max(NULLIF(trim(famille2), '')) AS famille
FROM public.gaia_stock
GROUP BY trim(inventory_id);

GRANT SELECT ON public.v_gaia_article_famille TO authenticated;
GRANT SELECT ON public.v_gaia_article_famille TO anon;

-- Rebuild v_gaia_parc_client to depend on the ungated famille view
CREATE OR REPLACE VIEW public.v_gaia_parc_client
WITH (security_invoker=on) AS
SELECT
  COALESCE(g.groupe, COALESCE(cl.name, l.code_client)) AS client,
  l.code_client,
  trim(l.code_article) AS code_article,
  max(s.description) AS description,
  f.famille,
  max(l.invoice_date) AS derniere_vente,
  sum(l.qty) AS quantite
FROM public.v_gaia_lignes l
JOIN public.v_gaia_article_famille f
  ON f.code = trim(l.code_article)
 AND f.famille IS NOT NULL
 AND f.famille <> 'Consommables'
LEFT JOIN (
  SELECT trim(inventory_id) AS code, max(description) AS description
  FROM public.gaia_stock
  GROUP BY trim(inventory_id)
) s ON s.code = trim(l.code_article)
LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
WHERE l.montant_ht > 0
  AND upper(trim(l.classe_article)) = 'JEUX'
GROUP BY COALESCE(g.groupe, COALESCE(cl.name, l.code_client)), l.code_client, trim(l.code_article), f.famille
HAVING sum(l.qty) > 0;

GRANT SELECT ON public.v_gaia_parc_client TO authenticated;
GRANT SELECT ON public.v_gaia_parc_client TO anon;