DROP MATERIALIZED VIEW IF EXISTS public.mv_gaia_resume_client_exercice CASCADE;

CREATE MATERIALIZED VIEW public.mv_gaia_resume_client_exercice AS
WITH base AS (
  SELECT (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer AS annee,
         COALESCE(g.groupe, cl.name, l.code_client) AS client,
         l.invoice_date,
         l.montant_ht,
         TRIM(BOTH FROM l.code_article) AS code_article
  FROM v_gaia_lignes l
  LEFT JOIN gaia_clients cl ON cl.customer_id = l.code_client
  LEFT JOIN gaia_client_groupes g ON g.code_client = l.code_client
  WHERE l.invoice_date IS NOT NULL
    AND NOT (l.code_article IN (SELECT code FROM v_gaia_ecotax_codes))
), agg AS (
  SELECT annee, client,
         sum(montant_ht) AS ca_ht,
         min(invoice_date) AS premiere_facture,
         max(invoice_date) AS derniere_facture,
         count(*) AS nb_lignes
  FROM base GROUP BY annee, client
), marge_agg AS (
  SELECT annee, client,
         sum(ca_avec_cout) AS ca_avec_cout,
         sum(marge_estimee) AS marge_estimee,
         CASE WHEN sum(ca_ht) > 0 THEN (sum(ca_avec_cout) / sum(ca_ht)) * 100 ELSE NULL END AS part_reelle
  FROM v_gaia_marge_client GROUP BY annee, client
), famille_agg AS (
  SELECT b.annee, b.client,
         COALESCE(a.famille, 'Pièces & divers') AS famille,
         sum(b.montant_ht) AS ca
  FROM base b LEFT JOIN v_gaia_articles a ON a.code = b.code_article
  GROUP BY b.annee, b.client, COALESCE(a.famille, 'Pièces & divers')
), famille AS (
  SELECT DISTINCT ON (annee, client) annee, client, famille AS famille_dominante
  FROM famille_agg ORDER BY annee, client, ca DESC NULLS LAST
), carnet AS (
  SELECT (EXTRACT(year FROM (d.date_document + '4 mons'::interval)))::integer AS annee,
         COALESCE(g.groupe, cl.name, d.code_client) AS client,
         d.categorie, d.total_ht
  FROM v_gaia_carnet_documents d
  LEFT JOIN gaia_clients cl ON cl.customer_id = d.code_client
  LEFT JOIN gaia_client_groupes g ON g.code_client = d.code_client
  WHERE d.date_document IS NOT NULL
), carnet_agg AS (
  SELECT annee, client,
         count(*) FILTER (WHERE categorie = 'devis') AS nb_devis,
         COALESCE(sum(total_ht) FILTER (WHERE categorie = 'devis'), 0) AS montant_devis_ouverts,
         count(*) FILTER (WHERE categorie = 'commande') AS nb_commandes,
         COALESCE(sum(total_ht) FILTER (WHERE categorie = 'commande'), 0) AS montant_commandes_ouvertes,
         count(*) FILTER (WHERE categorie = 'reparation') AS nb_reparations
  FROM carnet GROUP BY annee, client
), keys AS (
  SELECT annee, client FROM agg
  UNION
  SELECT annee, client FROM carnet_agg
)
SELECT k.annee, k.client,
       COALESCE(a.ca_ht, 0) AS ca_ht,
       m.ca_avec_cout, m.marge_estimee, m.part_reelle,
       COALESCE(a.nb_lignes, 0) AS nb_lignes,
       a.premiere_facture, a.derniere_facture,
       f.famille_dominante,
       COALESCE(c.nb_devis, 0) AS nb_devis,
       COALESCE(c.montant_devis_ouverts, 0) AS montant_devis_ouverts,
       COALESCE(c.nb_commandes, 0) AS nb_commandes,
       COALESCE(c.montant_commandes_ouvertes, 0) AS montant_commandes_ouvertes,
       COALESCE(c.nb_reparations, 0) AS nb_reparations
FROM keys k
LEFT JOIN agg a ON a.annee = k.annee AND a.client = k.client
LEFT JOIN marge_agg m ON m.annee = k.annee AND m.client = k.client
LEFT JOIN famille f ON f.annee = k.annee AND f.client = k.client
LEFT JOIN carnet_agg c ON c.annee = k.annee AND c.client = k.client;

CREATE UNIQUE INDEX mv_gaia_resume_client_exercice_pk
  ON public.mv_gaia_resume_client_exercice (annee, client);