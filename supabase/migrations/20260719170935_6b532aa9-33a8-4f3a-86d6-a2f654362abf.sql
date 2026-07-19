
-- ─────────────────────────────────────────────────────────────
-- Gestionnaire de notifications — Phase 1 (in-app uniquement)
-- ─────────────────────────────────────────────────────────────

-- 1. Registre des types
CREATE TABLE IF NOT EXISTS public.notification_types (
  cle TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  description TEXT,
  categorie TEXT NOT NULL DEFAULT 'alerte',   -- alerte | publication | systeme
  gravite_defaut TEXT NOT NULL DEFAULT 'info',-- info | attention | urgent
  visibilite_role TEXT NOT NULL DEFAULT 'tous', -- tous | direction | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_types TO authenticated;
GRANT ALL ON public.notification_types TO service_role;
ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_types_read_auth" ON public.notification_types FOR SELECT TO authenticated USING (true);

-- 2. Préférences par utilisateur
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type_cle TEXT NOT NULL REFERENCES public.notification_types(cle) ON DELETE CASCADE,
  canal TEXT NOT NULL DEFAULT 'inapp',   -- inapp (phase 1) | email (phase 2)
  mode TEXT NOT NULL DEFAULT 'instantane',-- instantane | resume_quotidien | jamais
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type_cle, canal)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_prefs_self_all" ON public.notification_prefs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_prefs_admin_read" ON public.notification_prefs FOR SELECT TO authenticated
  USING (public.is_admin());

-- 3. Notifications (état lu par utilisateur)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type_cle TEXT NOT NULL REFERENCES public.notification_types(cle) ON DELETE CASCADE,
  gravite TEXT NOT NULL DEFAULT 'info',
  titre TEXT NOT NULL,
  corps TEXT,
  lien TEXT,
  dedupe_key TEXT,          -- ex "devis_dormants:2026-07-19" pour regroupement
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  lu BOOLEAN NOT NULL DEFAULT false,
  lu_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, lu, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_dedupe
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_self_read" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "notif_self_update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. Seed du registre
INSERT INTO public.notification_types (cle, libelle, description, categorie, gravite_defaut, visibilite_role) VALUES
  ('clients_declin',       'Client majeur en déclin',       'Chute forte du CA vs N-1 pour un client important.', 'alerte', 'attention', 'tous'),
  ('devis_dormants',       'Devis dormant',                  'Devis important sans mouvement depuis 30-90 jours.',  'alerte', 'attention', 'tous'),
  ('ruptures_magasin',     'Rupture magasin à forte rotation','Pièce magasin en rupture qui se vend régulièrement.','alerte', 'attention', 'tous'),
  ('sav_sans_relance',     'SAV sans achat récent',          'Client en SAV sans achat depuis 6 mois : cible relance.','alerte','info','tous'),
  ('sav_urgents',          'Ticket SAV urgent',              'Ticket Zendesk urgent ou ouvert depuis plus de 7 jours.','alerte','urgent','tous'),
  ('marge_derive',         'Dérive de marge',                'Famille dont le taux de marque brute a chuté.',      'alerte', 'attention', 'direction'),
  ('veille_haute',         'Signal de veille',               'Signal marché d''importance haute détecté.',         'alerte', 'info',     'tous'),
  ('reliquats_gonflement', 'Reliquats en gonflement',        'Progression anormale du carnet de reliquats.',        'alerte', 'attention','tous'),
  ('sync_fresh',           'Synchro Cegid en échec',         'Dernière synchro Cegid réussie il y a plus de 36h.', 'systeme','urgent',   'admin'),
  ('briefing_quotidien',   'Briefing du matin',              'Synthèse Copilote publiée chaque matin.',            'publication','info','tous'),
  ('revue_generee',        'Revue stratégique générée',      'Nouvelle revue commerciale disponible.',              'publication','info','direction'),
  ('veille_publiee',       'Veille marché publiée',          'Nouveau rapport de veille disponible.',               'publication','info','tous')
ON CONFLICT (cle) DO UPDATE SET
  libelle = EXCLUDED.libelle,
  description = EXCLUDED.description,
  categorie = EXCLUDED.categorie,
  gravite_defaut = EXCLUDED.gravite_defaut,
  visibilite_role = EXCLUDED.visibilite_role;

-- 5. Défauts intelligents par rôle (utilisés par ensure_notification_prefs)
--    commercial : instantané sur devis_dormants + sav_sans_relance + briefing ; reste 'jamais'
--    direction  : tout en 'instantane' sauf marge/publications (instantane), rien à 'jamais'
--    admin      : comme direction + sync_fresh instantané
CREATE OR REPLACE FUNCTION public.ensure_notification_prefs(_uid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin_ BOOLEAN;
  is_dir_   BOOLEAN;
  t RECORD;
  default_mode TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin') INTO is_admin_;
  SELECT is_admin_ OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'direction') INTO is_dir_;

  FOR t IN SELECT * FROM public.notification_types LOOP
    -- filtre visibilité
    IF t.visibilite_role = 'direction' AND NOT is_dir_ THEN CONTINUE; END IF;
    IF t.visibilite_role = 'admin' AND NOT is_admin_ THEN CONTINUE; END IF;

    IF is_dir_ THEN
      default_mode := 'instantane';
    ELSE
      -- commercial : sélectif
      default_mode := CASE t.cle
        WHEN 'devis_dormants'   THEN 'instantane'
        WHEN 'sav_sans_relance' THEN 'instantane'
        WHEN 'sav_urgents'      THEN 'instantane'
        WHEN 'briefing_quotidien' THEN 'instantane'
        WHEN 'veille_publiee'   THEN 'instantane'
        ELSE 'jamais'
      END;
    END IF;

    INSERT INTO public.notification_prefs (user_id, type_cle, canal, mode)
    VALUES (_uid, t.cle, 'inapp', default_mode)
    ON CONFLICT (user_id, type_cle, canal) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_notification_prefs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_notification_prefs(UUID) TO authenticated, service_role;

-- 6. Dispatcher : crée les notifications pour les users éligibles selon prefs.
--    Regroupement possible via dedupe_key (unique par user).
CREATE OR REPLACE FUNCTION public.dispatch_notification(
  _type_cle TEXT,
  _titre TEXT,
  _corps TEXT DEFAULT NULL,
  _lien TEXT DEFAULT NULL,
  _gravite TEXT DEFAULT NULL,
  _dedupe_key TEXT DEFAULT NULL,
  _meta JSONB DEFAULT '{}'::jsonb
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  u RECORD;
  grav TEXT;
  n_created INTEGER := 0;
BEGIN
  SELECT * INTO t FROM public.notification_types WHERE cle = _type_cle;
  IF t IS NULL THEN RETURN 0; END IF;
  grav := COALESCE(_gravite, t.gravite_defaut);

  -- Cible : users éligibles par visibilité
  FOR u IN
    SELECT DISTINCT p.id
    FROM public.profiles p
    WHERE
      CASE t.visibilite_role
        WHEN 'admin'     THEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin')
        WHEN 'direction' THEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role IN ('admin','direction'))
        ELSE TRUE
      END
  LOOP
    -- S'assurer que les prefs existent
    PERFORM public.ensure_notification_prefs(u.id);

    -- Lire pref inapp
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_prefs
      WHERE user_id = u.id AND type_cle = _type_cle AND canal = 'inapp' AND mode <> 'jamais'
    ) THEN
      CONTINUE;
    END IF;

    -- Insert avec dedupe par user
    IF _dedupe_key IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type_cle, gravite, titre, corps, lien, dedupe_key, meta)
      VALUES (u.id, _type_cle, grav, _titre, _corps, _lien, _dedupe_key, _meta)
      ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
        titre = EXCLUDED.titre, corps = EXCLUDED.corps, lien = EXCLUDED.lien,
        gravite = EXCLUDED.gravite, meta = EXCLUDED.meta,
        lu = false, lu_at = NULL, created_at = now();
    ELSE
      INSERT INTO public.notifications (user_id, type_cle, gravite, titre, corps, lien, meta)
      VALUES (u.id, _type_cle, grav, _titre, _corps, _lien, _meta);
    END IF;
    n_created := n_created + 1;
  END LOOP;

  RETURN n_created;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_notification(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_notification(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;
