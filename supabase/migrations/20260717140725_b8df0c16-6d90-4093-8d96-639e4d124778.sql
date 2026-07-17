
-- 1. Config key for cost uplift (discreet calibration)
INSERT INTO public.gaia_config (key, value)
VALUES ('cost_uplift_pct', '5')
ON CONFLICT (key) DO NOTHING;

-- 2. v_gaia_cout_article: apply uplift + restrict to admin/direction
CREATE OR REPLACE VIEW public.v_gaia_cout_article
WITH (security_invoker = on) AS
SELECT
    TRIM(BOTH FROM inventory_id) AS code,
    max(NULLIF(dernier_cout, 0::numeric))
      * (1 + COALESCE(
          (SELECT NULLIF(value,'')::numeric FROM public.gaia_config WHERE key = 'cost_uplift_pct'),
          0
        ) / 100.0) AS cout_unitaire,
    max(NULLIF(TRIM(BOTH FROM famille2), '')) AS famille
FROM public.gaia_stock
WHERE public.is_direction()
GROUP BY TRIM(BOTH FROM inventory_id);

-- 3. v_gaia_marge_client: restrict to admin/direction
CREATE OR REPLACE VIEW public.v_gaia_marge_client
WITH (security_invoker = on) AS
SELECT
    (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer AS annee,
    COALESCE(max(g.groupe), max(COALESCE(cl.name, l.code_client))) AS client,
    round(sum(l.montant_ht)) AS ca_ht,
    round(sum(l.montant_ht) FILTER (WHERE (c.cout_unitaire IS NOT NULL))) AS ca_avec_cout,
    round(sum((l.montant_ht - (l.qty * c.cout_unitaire))) FILTER (WHERE (c.cout_unitaire IS NOT NULL))) AS marge_estimee
FROM public.v_gaia_lignes l
LEFT JOIN public.v_gaia_cout_article c ON c.code = TRIM(BOTH FROM l.code_article)
LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
WHERE l.invoice_date IS NOT NULL
  AND NOT (l.code_article IN (SELECT code FROM public.v_gaia_ecotax_codes))
  AND public.is_direction()
GROUP BY (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer,
         COALESCE(g.groupe, l.code_client);

-- 4. v_gaia_marge_famille: restrict to admin/direction
CREATE OR REPLACE VIEW public.v_gaia_marge_famille
WITH (security_invoker = on) AS
SELECT
    (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer AS annee,
    COALESCE(c.famille, 'Pièces & divers') AS famille,
    round(sum(l.montant_ht)) AS ca_ht,
    round(sum(l.montant_ht) FILTER (WHERE (c.cout_unitaire IS NOT NULL))) AS ca_avec_cout,
    round(sum((l.qty * c.cout_unitaire)) FILTER (WHERE (c.cout_unitaire IS NOT NULL))) AS cout_estime,
    round(sum((l.montant_ht - (l.qty * c.cout_unitaire))) FILTER (WHERE (c.cout_unitaire IS NOT NULL))) AS marge_estimee
FROM public.v_gaia_lignes l
LEFT JOIN public.v_gaia_cout_article c ON c.code = TRIM(BOTH FROM l.code_article)
WHERE l.invoice_date IS NOT NULL
  AND NOT (l.code_article IN (SELECT code FROM public.v_gaia_ecotax_codes))
  AND public.is_direction()
GROUP BY (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer,
         COALESCE(c.famille, 'Pièces & divers');

-- 5. v_gaia_magasin_marge: source cost from v_gaia_cout_article (uplift applied) + restrict
CREATE OR REPLACE VIEW public.v_gaia_magasin_marge
WITH (security_invoker = on) AS
SELECT
    (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer AS annee,
    sum(l.montant_ht) AS ca_ht,
    sum(l.montant_ht) FILTER (WHERE (c.cout_unitaire IS NOT NULL)) AS ca_avec_cout,
    sum((l.montant_ht - (l.qty * c.cout_unitaire))) FILTER (WHERE (c.cout_unitaire IS NOT NULL)) AS marge_estimee
FROM public.v_gaia_lignes l
LEFT JOIN public.v_gaia_cout_article c ON c.code = TRIM(BOTH FROM l.code_article)
WHERE upper(TRIM(BOTH FROM l.classe_article)) LIKE 'MAGASIN%'
  AND l.invoice_date IS NOT NULL
  AND NOT (l.code_article IN (SELECT code FROM public.v_gaia_ecotax_codes))
  AND public.is_direction()
GROUP BY (EXTRACT(year FROM (l.invoice_date + '4 mons'::interval)))::integer;
