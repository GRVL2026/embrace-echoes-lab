
DROP MATERIALIZED VIEW IF EXISTS public.mv_gaia_resume_client_exercice CASCADE;

CREATE MATERIALIZED VIEW public.mv_gaia_resume_client_exercice AS
WITH base AS (
  SELECT
    EXTRACT(year FROM l.invoice_date + interval '4 months')::int AS annee,
    COALESCE(g.groupe, cl.name, l.code_client) AS client,
    l.invoice_date,
    l.montant_ht,
    trim(l.code_article) AS code_article
  FROM public.v_gaia_lignes l
  LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
  LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
  WHERE l.invoice_date IS NOT NULL
    AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
),
agg AS (
  SELECT
    annee, client,
    SUM(montant_ht) AS ca_ht,
    MIN(invoice_date) AS premiere_facture,
    MAX(invoice_date) AS derniere_facture,
    COUNT(*) AS nb_lignes
  FROM base
  GROUP BY annee, client
),
marge_agg AS (
  SELECT annee, client,
         SUM(ca_avec_cout)  AS ca_avec_cout,
         SUM(marge_estimee) AS marge_estimee,
         CASE WHEN SUM(ca_ht) > 0 THEN SUM(ca_avec_cout) / SUM(ca_ht) * 100 END AS part_reelle
  FROM public.v_gaia_marge_client
  GROUP BY annee, client
),
famille_agg AS (
  SELECT b.annee, b.client,
         COALESCE(a.famille, 'Pièces & divers') AS famille,
         SUM(b.montant_ht) AS ca
  FROM base b
  LEFT JOIN public.v_gaia_articles a ON a.code = b.code_article
  GROUP BY b.annee, b.client, COALESCE(a.famille, 'Pièces & divers')
),
famille AS (
  SELECT DISTINCT ON (annee, client) annee, client, famille AS famille_dominante
  FROM famille_agg
  ORDER BY annee, client, ca DESC NULLS LAST
),
-- Carnet ouvert : réutilise EXACTEMENT v_gaia_carnet_documents (même logique
-- que le pipeline affiché : completed=false + statuts ouverts + order_type QT/SO/LO/PT/RP,
-- 1 ligne par n_cde). Exclut la SFA comme le carnet.
carnet AS (
  SELECT
    EXTRACT(year FROM d.date_document + interval '4 months')::int AS annee,
    COALESCE(g.groupe, cl.name, d.code_client) AS client,
    d.categorie,
    d.total_ht
  FROM public.v_gaia_carnet_documents d
  LEFT JOIN public.gaia_clients cl ON cl.customer_id = d.code_client
  LEFT JOIN public.gaia_client_groupes g ON g.code_client = d.code_client
  WHERE d.sfa = false
    AND d.date_document IS NOT NULL
),
carnet_agg AS (
  SELECT
    annee, client,
    COUNT(*)  FILTER (WHERE categorie = 'devis')      AS nb_devis,
    COALESCE(SUM(total_ht) FILTER (WHERE categorie = 'devis'), 0)    AS montant_devis_ouverts,
    COUNT(*)  FILTER (WHERE categorie = 'commande')   AS nb_commandes,
    COALESCE(SUM(total_ht) FILTER (WHERE categorie = 'commande'), 0) AS montant_commandes_ouvertes,
    COUNT(*)  FILTER (WHERE categorie = 'reparation') AS nb_reparations
  FROM carnet
  GROUP BY annee, client
),
keys AS (
  SELECT annee, client FROM agg
  UNION
  SELECT annee, client FROM carnet_agg
)
SELECT
  k.annee,
  k.client,
  COALESCE(a.ca_ht, 0)              AS ca_ht,
  m.ca_avec_cout,
  m.marge_estimee,
  m.part_reelle,
  COALESCE(a.nb_lignes, 0)          AS nb_lignes,
  a.premiere_facture,
  a.derniere_facture,
  f.famille_dominante,
  COALESCE(c.nb_devis, 0)                     AS nb_devis,
  COALESCE(c.montant_devis_ouverts, 0)        AS montant_devis_ouverts,
  COALESCE(c.nb_commandes, 0)                 AS nb_commandes,
  COALESCE(c.montant_commandes_ouvertes, 0)   AS montant_commandes_ouvertes,
  COALESCE(c.nb_reparations, 0)               AS nb_reparations
FROM keys k
LEFT JOIN agg        a ON a.annee = k.annee AND a.client = k.client
LEFT JOIN marge_agg  m ON m.annee = k.annee AND m.client = k.client
LEFT JOIN famille    f ON f.annee = k.annee AND f.client = k.client
LEFT JOIN carnet_agg c ON c.annee = k.annee AND c.client = k.client;

CREATE UNIQUE INDEX mv_gaia_resume_client_exercice_pk
  ON public.mv_gaia_resume_client_exercice(annee, client);
CREATE INDEX mv_gaia_resume_client_exercice_client_idx
  ON public.mv_gaia_resume_client_exercice(client);

REVOKE ALL ON public.mv_gaia_resume_client_exercice FROM PUBLIC;
REVOKE ALL ON public.mv_gaia_resume_client_exercice FROM anon, authenticated;
GRANT SELECT ON public.mv_gaia_resume_client_exercice TO service_role;
