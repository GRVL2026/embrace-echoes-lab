-- 1) Rôle lecture seule dédié
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_readonly') THEN
    CREATE ROLE copilot_readonly NOLOGIN;
  END IF;
END $$;

-- Révoquer tout droit potentiellement hérité
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM copilot_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM copilot_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM copilot_readonly;

GRANT USAGE ON SCHEMA public TO copilot_readonly;

-- SELECT uniquement sur les tables autorisées
GRANT SELECT ON
  public.gaia_ventes,
  public.gaia_historique,
  public.gaia_clients,
  public.catalogue_erp,
  public.prospects,
  public.gaia_entreprises
TO copilot_readonly;

-- Permettre au propriétaire de la fonction (postgres) de faire SET ROLE
GRANT copilot_readonly TO postgres;

-- 2) Remplacer gaia_query_restricted par une version sans whitelist regex
CREATE OR REPLACE FUNCTION public.gaia_query_restricted(sql_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rows jsonb;
  n int;
  q text;
  trimmed text;
  semi_pos int;
  tail text;
BEGIN
  IF sql_query IS NULL OR btrim(sql_query) = '' THEN
    RETURN jsonb_build_object('error', 'Requête vide');
  END IF;

  q := btrim(sql_query);

  -- Doit commencer par SELECT ou WITH
  IF q !~* '^(select|with)\s' THEN
    RETURN jsonb_build_object('error', 'Seules les requêtes SELECT/WITH sont autorisées');
  END IF;

  -- Une seule instruction : retirer un ';' final éventuel, refuser tout ';' suivi de contenu
  trimmed := regexp_replace(q, ';\s*$', '');
  semi_pos := position(';' IN trimmed);
  IF semi_pos > 0 THEN
    tail := btrim(substring(trimmed FROM semi_pos + 1));
    IF tail <> '' THEN
      RETURN jsonb_build_object('error', 'Une seule instruction SQL est autorisée');
    END IF;
    trimmed := substring(trimmed FROM 1 FOR semi_pos - 1);
  END IF;

  -- Exécution en lecture seule sous le rôle copilot_readonly :
  -- la base refuse elle-même toute écriture ou table non autorisée.
  SET LOCAL ROLE copilot_readonly;
  SET LOCAL statement_timeout = '5s';

  BEGIN
    EXECUTE format(
      'WITH _uq AS (%s) SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM _uq LIMIT 501) t',
      trimmed
    ) INTO rows;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN jsonb_build_object('error', SQLERRM);
  END;

  RESET ROLE;

  n := COALESCE(jsonb_array_length(rows), 0);
  IF n > 500 THEN
    RETURN jsonb_build_object(
      'rows', (SELECT jsonb_agg(x) FROM (SELECT jsonb_array_elements(rows) AS x LIMIT 500) s),
      'truncated', true,
      'note', 'Résultat tronqué à 500 lignes. Agrège dans le SQL (SUM/COUNT/GROUP BY).'
    );
  END IF;
  RETURN rows;
END;
$function$;

ALTER FUNCTION public.gaia_query_restricted(text) OWNER TO postgres;
