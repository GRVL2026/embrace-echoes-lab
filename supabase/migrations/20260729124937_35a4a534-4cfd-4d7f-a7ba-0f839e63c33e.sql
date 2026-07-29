CREATE OR REPLACE FUNCTION public.gaia_query_restricted(sql_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rows jsonb;
  n int;
  lowered text;
  cleaned text;
  ident text;
  allowed text[] := ARRAY[
    'gaia_clients','gaia_ventes','gaia_historique',
    'catalogue_erp','prospects','client_actions'
  ];
BEGIN
  IF sql_query IS NULL OR btrim(sql_query) = '' THEN
    RETURN jsonb_build_object('error', 'Requête vide');
  END IF;

  IF sql_query !~* '^\s*(select|with)\s' THEN
    RETURN jsonb_build_object('error', 'Seules les requêtes SELECT/WITH sont autorisées');
  END IF;

  lowered := lower(sql_query);

  -- Interdit toute écriture / DDL
  IF lowered ~ '\y(insert|update|delete|drop|alter|create|grant|revoke|truncate|comment|copy|call|do|vacuum|analyze|reindex|cluster|refresh|listen|notify|lock|set|reset|show|begin|commit|rollback|savepoint|execute|prepare|deallocate|security|attach|detach)\y' THEN
    RETURN jsonb_build_object('error', 'Mot-clé interdit détecté');
  END IF;

  -- Interdit schémas sensibles et fonctions dangereuses
  IF lowered ~ '\y(auth|storage|vault|realtime|supabase_functions|pg_catalog|pg_temp|information_schema|pg_policies|pg_roles|pg_shadow|pg_user)\.' THEN
    RETURN jsonb_build_object('error', 'Schéma non autorisé');
  END IF;

  IF lowered ~ '\y(pg_read_|pg_ls_|pg_stat_file|dblink|copy_from|lo_import|lo_export|current_setting|set_config|pg_sleep|pg_terminate|pg_cancel|pg_reload)\y' THEN
    RETURN jsonb_build_object('error', 'Fonction non autorisée');
  END IF;

  -- Retire chaînes et commentaires pour extraire les identifiants
  cleaned := regexp_replace(lowered, $re$'([^']|'')*'$re$, ' ', 'g');
  cleaned := regexp_replace(cleaned, '--[^\n]*', ' ', 'g');
  cleaned := regexp_replace(cleaned, '/\*.*?\*/', ' ', 'g');

  -- Vérifie chaque objet référencé après FROM / JOIN
  FOR ident IN
    SELECT DISTINCT m[1]
    FROM regexp_matches(
      cleaned,
      '(?:from|join)\s+(?:only\s+)?([a-z_][a-z0-9_$]*(?:\.[a-z_][a-z0-9_$]*)?)',
      'g'
    ) AS m
  LOOP
    -- Refuse tout schéma explicite (sauf public)
    IF position('.' IN ident) > 0 THEN
      IF split_part(ident, '.', 1) <> 'public' THEN
        RETURN jsonb_build_object('error', format('Objet non autorisé : %s', ident));
      END IF;
      ident := split_part(ident, '.', 2);
    END IF;

    IF NOT (ident = ANY(allowed)) THEN
      RETURN jsonb_build_object('error', format('Table non autorisée : %s (whitelist : %s)', ident, array_to_string(allowed, ', ')));
    END IF;
  END LOOP;

  SET LOCAL statement_timeout = '8s';
  SET TRANSACTION READ ONLY;

  EXECUTE format(
    'WITH _uq AS (%s) SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM _uq LIMIT 501) t',
    sql_query
  ) INTO rows;

  n := COALESCE(jsonb_array_length(rows), 0);
  IF n > 500 THEN
    RETURN jsonb_build_object(
      'rows', (SELECT jsonb_agg(x) FROM (SELECT jsonb_array_elements(rows) AS x LIMIT 500) s),
      'truncated', true,
      'note', 'Résultat tronqué à 500 lignes. Agrège dans le SQL (SUM/COUNT/GROUP BY).'
    );
  END IF;
  RETURN rows;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.gaia_query_restricted(text) FROM public;
GRANT EXECUTE ON FUNCTION public.gaia_query_restricted(text) TO authenticated, service_role;