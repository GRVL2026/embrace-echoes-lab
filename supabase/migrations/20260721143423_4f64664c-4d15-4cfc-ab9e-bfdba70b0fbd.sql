
CREATE OR REPLACE VIEW public.v_gaia_cout_article
WITH (security_invoker = on) AS
SELECT
  btrim(inventory_id) AS code,
  (max(NULLIF(dernier_cout, 0::numeric))
    * (1::numeric + COALESCE(
        (SELECT NULLIF(gaia_config.value, '')::numeric
           FROM public.gaia_config
          WHERE gaia_config.key = 'cost_uplift_pct'),
        0::numeric) / 100.0)
  ) AS cout_unitaire,
  max(NULLIF(btrim(famille2), '')) AS famille
FROM public.gaia_stock
GROUP BY btrim(inventory_id);

CREATE OR REPLACE VIEW public.v_gaia_marge_client
WITH (security_invoker = on) AS
SELECT
  (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer AS annee,
  COALESCE(max(g.groupe), max(COALESCE(cl.name, l.code_client))) AS client,
  round(sum(l.montant_ht)) AS ca_ht,
  round(sum(l.montant_ht) FILTER (WHERE (l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL))) AS ca_avec_cout,
  round(sum(COALESCE(l.marge_ligne, (l.montant_ht - (l.qty * c.cout_unitaire))))
        FILTER (WHERE (l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL))) AS marge_estimee,
  CASE
    WHEN sum(l.montant_ht) > 0::numeric
      THEN round((100.0 * COALESCE(sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL), 0::numeric)) / sum(l.montant_ht), 1)
    ELSE 0::numeric
  END AS part_reelle
FROM public.v_gaia_lignes_marge l
LEFT JOIN public.v_gaia_cout_article c ON c.code = btrim(l.code_article)
LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
WHERE l.invoice_date IS NOT NULL
  AND NOT (l.code_article IN (SELECT code FROM public.v_gaia_ecotax_codes))
GROUP BY ((EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer),
         COALESCE(g.groupe, l.code_client);

CREATE OR REPLACE VIEW public.v_gaia_marge_famille
WITH (security_invoker = on) AS
SELECT
  (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer AS annee,
  COALESCE(c.famille, 'Pièces & divers'::text) AS famille,
  round(sum(l.montant_ht)) AS ca_ht,
  round(sum(l.montant_ht) FILTER (WHERE (l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL))) AS ca_avec_cout,
  round(sum(COALESCE(l.cout_total, (l.qty * c.cout_unitaire)))
        FILTER (WHERE (l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL))) AS cout_estime,
  round(sum(COALESCE(l.marge_ligne, (l.montant_ht - (l.qty * c.cout_unitaire))))
        FILTER (WHERE (l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL))) AS marge_estimee,
  CASE
    WHEN sum(l.montant_ht) > 0::numeric
      THEN round((100.0 * COALESCE(sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL), 0::numeric)) / sum(l.montant_ht), 1)
    ELSE 0::numeric
  END AS part_reelle
FROM public.v_gaia_lignes_marge l
LEFT JOIN public.v_gaia_cout_article c ON c.code = btrim(l.code_article)
WHERE l.invoice_date IS NOT NULL
  AND NOT (l.code_article IN (SELECT code FROM public.v_gaia_ecotax_codes))
GROUP BY ((EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer),
         COALESCE(c.famille, 'Pièces & divers'::text);

-- Confidentialité : accès direct réservé au service applicatif (edge functions).
-- Les utilisateurs finaux passent par le copilote / l'UI qui vérifient déjà le rôle direction/admin.
REVOKE ALL ON public.v_gaia_cout_article FROM anon, authenticated;
REVOKE ALL ON public.v_gaia_marge_client FROM anon, authenticated;
REVOKE ALL ON public.v_gaia_marge_famille FROM anon, authenticated;
GRANT SELECT ON public.v_gaia_cout_article TO service_role;
GRANT SELECT ON public.v_gaia_marge_client TO service_role;
GRANT SELECT ON public.v_gaia_marge_famille TO service_role;
