
-- 1) Verrouiller l'accès direct aux vues sensibles
REVOKE ALL ON public.v_gaia_cout_article  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.v_gaia_marge_client  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.v_gaia_marge_famille FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.v_gaia_lignes_marge  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.v_gaia_magasin_marge FROM anon, authenticated, PUBLIC;

GRANT SELECT ON public.v_gaia_cout_article  TO service_role;
GRANT SELECT ON public.v_gaia_marge_client  TO service_role;
GRANT SELECT ON public.v_gaia_marge_famille TO service_role;
GRANT SELECT ON public.v_gaia_lignes_marge  TO service_role;
GRANT SELECT ON public.v_gaia_magasin_marge TO service_role;

-- 2) Retirer is_direction() du WHERE de v_gaia_magasin_marge (même raison que les autres vues de marge)
CREATE OR REPLACE VIEW public.v_gaia_magasin_marge
WITH (security_invoker=on) AS
SELECT
  EXTRACT(year FROM l.invoice_date + interval '4 mons')::integer AS annee,
  sum(l.montant_ht) AS ca_ht,
  sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL) AS ca_avec_cout,
  sum(COALESCE(l.marge_ligne, l.montant_ht - l.qty * c.cout_unitaire))
    FILTER (WHERE l.marge_ligne IS NOT NULL OR c.cout_unitaire IS NOT NULL) AS marge_estimee,
  CASE WHEN sum(l.montant_ht) > 0
       THEN round(100.0 * COALESCE(sum(l.montant_ht) FILTER (WHERE l.marge_ligne IS NOT NULL), 0) / sum(l.montant_ht), 1)
       ELSE 0 END AS part_reelle
FROM public.v_gaia_lignes_marge l
LEFT JOIN public.v_gaia_cout_article c ON c.code = btrim(l.code_article)
WHERE upper(btrim(l.classe_article)) LIKE 'MAGASIN%'
  AND l.invoice_date IS NOT NULL
  AND l.code_article NOT IN (SELECT code FROM public.v_gaia_ecotax_codes)
GROUP BY EXTRACT(year FROM l.invoice_date + interval '4 mons')::integer;

REVOKE ALL ON public.v_gaia_magasin_marge FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.v_gaia_magasin_marge TO service_role;

-- 3) Fonctions SECURITY DEFINER réservées à la direction/admin
CREATE OR REPLACE FUNCTION public.get_marge_client()
RETURNS TABLE (annee int, client text, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, part_reelle numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.annee, v.client, v.ca_ht, v.ca_avec_cout, v.marge_estimee, v.part_reelle
               FROM public.v_gaia_marge_client v;
END; $$;

CREATE OR REPLACE FUNCTION public.get_marge_famille()
RETURNS TABLE (annee int, famille text, ca_ht numeric, ca_avec_cout numeric, cout_estime numeric, marge_estimee numeric, part_reelle numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.annee, v.famille, v.ca_ht, v.ca_avec_cout, v.cout_estime, v.marge_estimee, v.part_reelle
               FROM public.v_gaia_marge_famille v;
END; $$;

CREATE OR REPLACE FUNCTION public.get_magasin_marge()
RETURNS TABLE (annee int, ca_ht numeric, ca_avec_cout numeric, marge_estimee numeric, part_reelle numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.annee, v.ca_ht, v.ca_avec_cout, v.marge_estimee, v.part_reelle
               FROM public.v_gaia_magasin_marge v;
END; $$;

-- Codes articles d'une famille (utilisé par le drill-down famille du dashboard direction).
-- N'expose PAS le coût unitaire, uniquement les codes.
CREATE OR REPLACE FUNCTION public.get_cout_article_famille(_famille text)
RETURNS TABLE (code text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_direction() OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v.code FROM public.v_gaia_cout_article v WHERE v.famille = _famille;
END; $$;

-- Verrouiller EXECUTE
REVOKE ALL ON FUNCTION public.get_marge_client()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_marge_famille()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_magasin_marge()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cout_article_famille(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_marge_client()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_marge_famille()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_magasin_marge()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cout_article_famille(text) TO authenticated;
