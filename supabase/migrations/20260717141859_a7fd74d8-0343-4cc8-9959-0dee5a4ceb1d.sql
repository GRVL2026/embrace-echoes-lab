-- 1. Nouvelles colonnes marge réelle sur les ventes
ALTER TABLE public.gaia_ventes
  ADD COLUMN IF NOT EXISTS cout_total  numeric,
  ADD COLUMN IF NOT EXISTS marge_ligne numeric,
  ADD COLUMN IF NOT EXISTS taux_marque numeric;

-- 2. Vue lignes avec marge réelle (repli NULL sur historique)
CREATE OR REPLACE VIEW public.v_gaia_lignes_marge
WITH (security_invoker=on) AS
SELECT
  v.invoice_date,
  v.code_client,
  v.code_article,
  v.inventory_id,
  v.classe_article,
  CASE WHEN v.tran_type = 'CRM' THEN -abs(v.montant_ht) ELSE v.montant_ht END AS montant_ht,
  CASE WHEN v.tran_type = 'CRM' THEN -abs(v.qty)        ELSE v.qty        END AS qty,
  CASE
    WHEN v.cout_total IS NULL THEN NULL
    WHEN v.tran_type = 'CRM' THEN -abs(v.cout_total)
    ELSE v.cout_total
  END AS cout_total,
  CASE
    WHEN v.marge_ligne IS NULL THEN NULL
    WHEN v.tran_type = 'CRM' THEN -abs(v.marge_ligne)
    ELSE v.marge_ligne
  END AS marge_ligne
FROM public.gaia_ventes v
WHERE v.code_client NOT IN (SELECT code FROM public.v_gaia_excluded_clients)
UNION ALL
SELECT
  h.invoice_date,
  h.code_client,
  h.code_article,
  h.inventory_id,
  h.classe_article,
  h.montant_ht,
  h.qty,
  NULL::numeric AS cout_total,
  NULL::numeric AS marge_ligne
FROM public.gaia_historique h
WHERE h.code_client NOT IN (SELECT code FROM public.v_gaia_excluded_clients);

GRANT SELECT ON public.v_gaia_lignes_marge TO authenticated;

-- 3. Vues de marge refondues (réelle + repli estimé + part_reelle)
CREATE OR REPLACE VIEW public.v_gaia_marge_client
WITH (security_invoker=on) AS
SELECT
  EXTRACT(year FROM l.invoice_date + interval '4 mons')::int AS annee,
  COALESCE(max(g.groupe), max(COALESCE(cl.name, l.code_client))) AS client,
  round(sum(l.montant_ht)) AS ca_ht,
  round(sum(l.montant_ht) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  )) AS ca_avec_cout,
  round(sum(
    COALESCE(l.marge_ligne, l.montant_ht - l.qty * c.cout_unitaire)
  ) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  )) AS marge_estimee,
  CASE
    WHEN sum(l.montant_ht) > 0 THEN
      round(100.0 * COALESCE(sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL), 0)
        / sum(l.montant_ht), 1)
    ELSE 0
  END AS part_reelle
FROM public.v_gaia_lignes_marge l
LEFT JOIN public.v_gaia_cout_article c ON c.code = trim(l.code_article)
LEFT JOIN public.gaia_clients cl ON cl.customer_id = l.code_client
LEFT JOIN public.gaia_client_groupes g ON g.code_client = l.code_client
WHERE l.invoice_date IS NOT NULL
  AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
  AND public.is_direction()
GROUP BY EXTRACT(year FROM l.invoice_date + interval '4 mons')::int,
         COALESCE(g.groupe, l.code_client);

CREATE OR REPLACE VIEW public.v_gaia_marge_famille
WITH (security_invoker=on) AS
SELECT
  EXTRACT(year FROM l.invoice_date + interval '4 mons')::int AS annee,
  COALESCE(c.famille, 'Pièces & divers') AS famille,
  round(sum(l.montant_ht)) AS ca_ht,
  round(sum(l.montant_ht) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  )) AS ca_avec_cout,
  round(sum(
    COALESCE(l.cout_total, l.qty * c.cout_unitaire)
  ) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  )) AS cout_estime,
  round(sum(
    COALESCE(l.marge_ligne, l.montant_ht - l.qty * c.cout_unitaire)
  ) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  )) AS marge_estimee,
  CASE
    WHEN sum(l.montant_ht) > 0 THEN
      round(100.0 * COALESCE(sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL), 0)
        / sum(l.montant_ht), 1)
    ELSE 0
  END AS part_reelle
FROM public.v_gaia_lignes_marge l
LEFT JOIN public.v_gaia_cout_article c ON c.code = trim(l.code_article)
WHERE l.invoice_date IS NOT NULL
  AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
  AND public.is_direction()
GROUP BY EXTRACT(year FROM l.invoice_date + interval '4 mons')::int,
         COALESCE(c.famille, 'Pièces & divers');

CREATE OR REPLACE VIEW public.v_gaia_magasin_marge
WITH (security_invoker=on) AS
SELECT
  EXTRACT(year FROM l.invoice_date + interval '4 mons')::int AS annee,
  sum(l.montant_ht) AS ca_ht,
  sum(l.montant_ht) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  ) AS ca_avec_cout,
  sum(
    COALESCE(l.marge_ligne, l.montant_ht - l.qty * c.cout_unitaire)
  ) FILTER (
    WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL
  ) AS marge_estimee,
  CASE
    WHEN sum(l.montant_ht) > 0 THEN
      round(100.0 * COALESCE(sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL), 0)
        / sum(l.montant_ht), 1)
    ELSE 0
  END AS part_reelle
FROM public.v_gaia_lignes_marge l
LEFT JOIN public.v_gaia_cout_article c ON c.code = trim(l.code_article)
WHERE upper(trim(l.classe_article)) LIKE 'MAGASIN%'
  AND l.invoice_date IS NOT NULL
  AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
  AND public.is_direction()
GROUP BY EXTRACT(year FROM l.invoice_date + interval '4 mons')::int;