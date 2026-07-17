
CREATE OR REPLACE VIEW public.v_gaia_parc_client
WITH (security_invoker = on) AS
SELECT COALESCE(g.groupe, COALESCE(cl.name, l.code_client)) AS client,
    l.code_client,
    TRIM(BOTH FROM l.code_article) AS code_article,
    max(s.description) AS description,
    c.famille,
    max(l.invoice_date) AS derniere_vente,
    sum(l.qty) AS quantite
FROM v_gaia_lignes l
    JOIN v_gaia_cout_article c
      ON c.code = TRIM(BOTH FROM l.code_article)
     AND c.famille IS NOT NULL
     AND c.famille <> 'Consommables'
    LEFT JOIN (
        SELECT TRIM(BOTH FROM inventory_id) AS code,
               max(description) AS description
        FROM gaia_stock
        GROUP BY TRIM(BOTH FROM inventory_id)
    ) s ON s.code = TRIM(BOTH FROM l.code_article)
    LEFT JOIN gaia_clients cl ON cl.customer_id = l.code_client
    LEFT JOIN gaia_client_groupes g ON g.code_client = l.code_client
WHERE l.montant_ht > 0::numeric
  AND upper(trim(l.classe_article)) = 'JEUX'
GROUP BY COALESCE(g.groupe, COALESCE(cl.name, l.code_client)),
         l.code_client,
         TRIM(BOTH FROM l.code_article),
         c.famille
HAVING sum(l.qty) > 0::numeric;
