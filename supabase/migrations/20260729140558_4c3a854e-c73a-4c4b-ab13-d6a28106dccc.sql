DROP FUNCTION IF EXISTS public.get_prospection_resume();
CREATE OR REPLACE FUNCTION public.get_prospection_resume()
 RETURNS TABLE(total integer, nouveau integer, contacte integer, connecte integer, repondu integer, rdv integer, devis integer, client integer, perdu integer, ca_attribue numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::int,
    count(*) FILTER (WHERE statut='nouveau')::int,
    count(*) FILTER (WHERE statut='contacte')::int,
    count(*) FILTER (WHERE statut='connecte')::int,
    count(*) FILTER (WHERE statut='repondu')::int,
    count(*) FILTER (WHERE statut='rdv')::int,
    count(*) FILTER (WHERE statut='devis')::int,
    count(*) FILTER (WHERE statut='client')::int,
    count(*) FILTER (WHERE statut='perdu')::int,
    coalesce((SELECT sum(v.montant_ht) FROM gaia_ventes v WHERE v.code_client IN (SELECT code_client FROM prospects WHERE code_client IS NOT NULL AND trim(code_client)<>'') AND v.invoice_date >= CURRENT_DATE - INTERVAL '12 months'),0)
  FROM prospects;
$function$;