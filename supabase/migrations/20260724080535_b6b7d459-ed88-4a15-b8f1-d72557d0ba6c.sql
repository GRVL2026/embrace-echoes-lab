
DROP FUNCTION IF EXISTS public.get_briefing_semaine_docs(text);

CREATE OR REPLACE FUNCTION public.get_briefing_semaine_docs(_type_doc text)
RETURNS TABLE(jour date, n_cde text, type_doc text, code_client text, montant_ht numeric, univers text, proprietaire text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH bornes AS (
    SELECT date_trunc('week', current_date)::date AS lundi,
           (date_trunc('week', current_date) + interval '4 days')::date AS vendredi
  ),
  lignes AS (
    SELECT invoice_date AS jour, n_cde,
      CASE type_cde WHEN 'QT' THEN 'devis' ELSE 'commande' END AS type_doc,
      code_client, proprietaire_id,
      CASE WHEN classe_article ILIKE 'JEUX%' THEN 'jeux' ELSE 'magasin' END AS univ,
      coalesce(montant_ht,0) AS m
    FROM gaia_commandes, bornes
    WHERE type_cde IN ('QT','SO')
      AND invoice_date BETWEEN bornes.lundi AND bornes.vendredi
      AND ((_type_doc = 'devis' AND type_cde = 'QT') OR (_type_doc = 'commande' AND type_cde = 'SO'))
  ),
  doc AS (
    SELECT jour, n_cde,
      max(type_doc) type_doc,
      max(code_client) code_client,
      max(proprietaire_id) proprietaire_id,
      sum(m) montant_ht,
      (array_agg(univ ORDER BY m DESC))[1] univers
    FROM lignes GROUP BY jour, n_cde
  )
  SELECT d.jour, d.n_cde, d.type_doc, d.code_client, d.montant_ht, d.univers, e.nom
  FROM doc d LEFT JOIN gaia_equipe e ON e.contact_id = d.proprietaire_id
  ORDER BY d.jour DESC, d.montant_ht DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_briefing_semaine_docs(text) TO authenticated, service_role;
