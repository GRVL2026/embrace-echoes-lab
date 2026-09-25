-- 25/09/2026 — Le directeur commercial (`chef_ventes`) a la même portée que la direction
-- sur les données commerciales. Deux fonctions l'en excluaient encore.
--
-- Symptôme rapporté : Tristan cliquait sur la Carte, elle s'affichait, puis l'affichage des
-- clients renvoyait « forbidden ». Le mot vient littéralement de `get_map_points()`.
--
-- ⚠️ Corps repris du corps RÉELLEMENT DÉPLOYÉ (lu via pg_get_functiondef le 25/09), et non du
-- fichier de migration d'origine : le SQL collé à la main dans Lovable n'existe pas dans git, et
-- les deux avaient divergé. Seule la ligne de garde change.
--
-- À NE PAS refaire ici : `can_access_prospection()` incluait DÉJÀ `chef_ventes` en production
-- (vérifié le 25/09). La migration 20260724202651 est périmée sur ce point — ne pas la rejouer,
-- elle retirerait l'accès.

-- 1. La carte des clients. C'est le correctif qui débloque le symptôme.
CREATE OR REPLACE FUNCTION public.get_map_points()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  clients_json jsonb;
  prospects_json jsonb;
BEGIN
  -- is_management() couvre admin, direction ET chef_ventes.
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH union_all AS (
    SELECT code_client, invoice_date, montant_ht FROM public.gaia_ventes
    UNION ALL
    SELECT code_client, invoice_date, montant_ht FROM public.gaia_historique
  ),
  agg AS (
    SELECT
      code_client,
      MAX(invoice_date) AS derniere_commande,
      COALESCE(SUM(montant_ht), 0) AS ca_total,
      COALESCE(SUM(montant_ht) FILTER (WHERE invoice_date >= CURRENT_DATE - INTERVAL '12 months'), 0) AS ca_12m,
      MAX(invoice_date) FILTER (WHERE invoice_date >= CURRENT_DATE - INTERVAL '24 months') AS derniere_24m
    FROM union_all
    WHERE code_client IS NOT NULL
    GROUP BY code_client
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code_client', c.customer_id, 'nom', c.name, 'ville', c.ville,
    'lat', c.lat, 'lng', c.lng,
    'ca_12m', COALESCE(a.ca_12m, 0), 'ca_total', COALESCE(a.ca_total, 0),
    'derniere_commande', a.derniere_commande,
    'categorie', CASE
      WHEN a.derniere_commande IS NOT NULL AND a.derniere_commande >= CURRENT_DATE - INTERVAL '12 months' THEN 'actif'
      WHEN a.derniere_commande IS NOT NULL AND a.derniere_commande >= CURRENT_DATE - INTERVAL '24 months' THEN 'dormant'
      ELSE 'inactif' END
  )), '[]'::jsonb)
  INTO clients_json
  FROM public.gaia_clients c
  LEFT JOIN agg a ON a.code_client = c.customer_id
  WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'nom', p.entreprise, 'ville', p.ville,
    'lat', p.lat, 'lng', p.lng, 'statut', p.statut, 'segment', p.segment,
    'proprietaire', p.proprietaire, 'proprietaire_nom', pr.full_name
  )), '[]'::jsonb)
  INTO prospects_json
  FROM public.prospects p
  LEFT JOIN public.profiles pr ON pr.id = p.proprietaire
  WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL;

  RETURN jsonb_build_object('clients', clients_json, 'prospects', prospects_json);
END;
$function$;

-- 2. Le bloc « relance » de la bulle client. Sans ça, cliquer un client sur la carte ouvre la
-- bulle mais le statut reste vide SANS message d'erreur : l'appelant (Carte.tsx:552) ne teste
-- jamais l'erreur, il vide le bloc. Panne silencieuse, la pire à diagnostiquer.
CREATE OR REPLACE FUNCTION public.can_reactivation(_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_management(_uid)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = _uid
        AND lower(email) IN (
          'romain.lirola@avranchesautomatic.com',
          'valerie@avranchesautomatic.com'
        )
    );
$function$;
