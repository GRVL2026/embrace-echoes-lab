CREATE OR REPLACE FUNCTION public.gaia_query(sql_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rows jsonb;
  n int;
BEGIN
  IF sql_query !~* '^\s*(select|with)\s' THEN
    RETURN jsonb_build_object('error', 'Seules les requêtes SELECT sont autorisées');
  END IF;
  IF sql_query ~* '(insert|update|delete|drop|alter|create|grant|truncate)\s' THEN
    RETURN jsonb_build_object('error', 'Mot-clé interdit détecté');
  END IF;
  SET LOCAL statement_timeout = '8s';
  SET TRANSACTION READ ONLY;
  EXECUTE format('WITH _uq AS (%s) SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM _uq LIMIT 501) t', sql_query)
    INTO rows;
  n := COALESCE(jsonb_array_length(rows), 0);
  IF n > 500 THEN
    RETURN jsonb_build_object(
      'rows', (SELECT jsonb_agg(x) FROM (SELECT jsonb_array_elements(rows) AS x LIMIT 500) s),
      'truncated', true,
      'note', 'Résultat tronqué à 500 lignes. Agrège dans le SQL (SUM/COUNT/GROUP BY) plutôt que de récupérer des lignes brutes, ou interroge d''abord mv_gaia_resume_client_exercice / mv_gaia_resume_mensuel.'
    );
  END IF;
  RETURN rows;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;