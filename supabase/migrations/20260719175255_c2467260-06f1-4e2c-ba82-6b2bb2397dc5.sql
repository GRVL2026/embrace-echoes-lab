
-- 1. Trace du lanceur
ALTER TABLE public.veille_jobs ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.veille_rapports ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Nouveaux types de notification (erreurs)
INSERT INTO public.notification_types (cle, libelle, description, categorie, gravite_defaut, visibilite_role) VALUES
  ('revue_erreur',   'Revue commerciale en échec', 'Une génération de revue lancée par vous a échoué.',   'publication', 'attention', 'tous'),
  ('veille_erreur',  'Veille marché en échec',     'Une génération de veille lancée par vous a échoué.',  'publication', 'attention', 'tous')
ON CONFLICT (cle) DO UPDATE SET
  libelle = EXCLUDED.libelle,
  description = EXCLUDED.description,
  categorie = EXCLUDED.categorie,
  gravite_defaut = EXCLUDED.gravite_defaut,
  visibilite_role = EXCLUDED.visibilite_role;

-- 3. notify_user : envoie une notification à UN utilisateur précis
-- (ignore la visibilité rôle et les préférences 'jamais' pour ce type
--  précis, car c'est une réponse directe à une action que l'utilisateur
--  a lui-même déclenchée).
CREATE OR REPLACE FUNCTION public.notify_user(
  _user_id UUID,
  _type_cle TEXT,
  _titre TEXT,
  _corps TEXT DEFAULT NULL,
  _lien TEXT DEFAULT NULL,
  _gravite TEXT DEFAULT NULL,
  _dedupe_key TEXT DEFAULT NULL,
  _meta JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  grav TEXT;
  new_id UUID;
BEGIN
  IF _user_id IS NULL OR _type_cle IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.notification_types WHERE cle = _type_cle;
  IF t IS NULL THEN RETURN NULL; END IF;
  grav := COALESCE(_gravite, t.gravite_defaut);

  IF _dedupe_key IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type_cle, gravite, titre, corps, lien, dedupe_key, meta)
    VALUES (_user_id, _type_cle, grav, _titre, _corps, _lien, _dedupe_key, _meta)
    ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
      titre = EXCLUDED.titre, corps = EXCLUDED.corps, lien = EXCLUDED.lien,
      gravite = EXCLUDED.gravite, meta = EXCLUDED.meta,
      lu = false, lu_at = NULL, created_at = now()
    RETURNING id INTO new_id;
  ELSE
    INSERT INTO public.notifications (user_id, type_cle, gravite, titre, corps, lien, meta)
    VALUES (_user_id, _type_cle, grav, _titre, _corps, _lien, _meta)
    RETURNING id INTO new_id;
  END IF;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_user(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- 4. Realtime — cloche réactive
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
