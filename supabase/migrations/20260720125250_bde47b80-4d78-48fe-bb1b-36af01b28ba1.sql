CREATE OR REPLACE VIEW public.v_gaia_parc_client AS
WITH lignes AS (
  SELECT v.invoice_date, v.code_client, v.code_article, v.classe_article,
         CASE WHEN v.tran_type = 'CRM' THEN -abs(v.montant_ht) ELSE v.montant_ht END AS montant_ht,
         CASE WHEN v.tran_type = 'CRM' THEN -abs(v.qty) ELSE v.qty END AS qty
  FROM gaia_ventes v
  WHERE v.code_client NOT IN (SELECT code FROM v_gaia_excluded_clients)
    AND (v.n_fact IS NULL OR TRIM(v.n_fact) NOT ILIKE 'ACP%')
  UNION ALL
  SELECT h.invoice_date, h.code_client, h.code_article, h.classe_article, h.montant_ht, h.qty
  FROM gaia_historique h
  WHERE h.code_client NOT IN (SELECT code FROM v_gaia_excluded_clients)
)
SELECT COALESCE(g.groupe, COALESCE(cl.name, l.code_client)) AS client,
   l.code_client,
   TRIM(BOTH FROM l.code_article) AS code_article,
   max(s.description) AS description,
   f.famille,
   max(l.invoice_date) AS derniere_vente,
   sum(l.qty) AS quantite
  FROM lignes l
    JOIN v_gaia_article_famille f ON f.code = TRIM(BOTH FROM l.code_article) AND f.famille IS NOT NULL AND f.famille <> 'Consommables'
    LEFT JOIN (SELECT TRIM(BOTH FROM gaia_stock.inventory_id) AS code,
             max(gaia_stock.description) AS description
            FROM gaia_stock
           GROUP BY TRIM(BOTH FROM gaia_stock.inventory_id)) s ON s.code = TRIM(BOTH FROM l.code_article)
    LEFT JOIN gaia_clients cl ON cl.customer_id = l.code_client
    LEFT JOIN gaia_client_groupes g ON g.code_client = l.code_client
 WHERE l.montant_ht > 0
   AND upper(TRIM(BOTH FROM l.classe_article)) = 'JEUX'
 GROUP BY COALESCE(g.groupe, COALESCE(cl.name, l.code_client)), l.code_client, TRIM(BOTH FROM l.code_article), f.famille
HAVING sum(l.qty) > 0;