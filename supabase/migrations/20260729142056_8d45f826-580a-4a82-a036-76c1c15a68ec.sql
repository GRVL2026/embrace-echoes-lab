
CREATE OR REPLACE FUNCTION public.import_prospects_csv(_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean;
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT allowed INTO _allowed
  FROM public.user_menu_access
  WHERE user_id = _uid AND section_key = 'prospection.importer_csv';

  IF COALESCE(_allowed, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Action réservée (permission manquante : prospection.importer_csv)' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.prospects (
    entreprise, contact_nom, contact_role, ville, segment,
    email, telephone, linkedin_url, signal, statut, owner_id
  )
  SELECT
    NULLIF(btrim(r->>'entreprise'), ''),
    NULLIF(btrim(r->>'contact_nom'), ''),
    NULLIF(btrim(r->>'contact_role'), ''),
    NULLIF(btrim(r->>'ville'), ''),
    COALESCE(NULLIF(btrim(r->>'segment'), ''), 'autre'),
    NULLIF(btrim(r->>'email'), ''),
    NULLIF(btrim(r->>'telephone'), ''),
    NULLIF(btrim(r->>'linkedin_url'), ''),
    NULLIF(btrim(r->>'signal'), ''),
    COALESCE(NULLIF(btrim(r->>'statut'), ''), 'nouveau'),
    _uid
  FROM jsonb_array_elements(_rows) AS r
  WHERE COALESCE(btrim(r->>'entreprise'), '') <> '';

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_prospects_csv(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_prospects_csv(jsonb) TO authenticated;
