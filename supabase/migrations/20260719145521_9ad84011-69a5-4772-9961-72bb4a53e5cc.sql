
CREATE TABLE IF NOT EXISTS public.veille_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  plateforme text,
  categorie text NOT NULL,
  priorite int NOT NULL DEFAULT 2 CHECK (priorite BETWEEN 1 AND 3),
  note text,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.veille_watchlist TO authenticated;
GRANT ALL ON public.veille_watchlist TO service_role;

ALTER TABLE public.veille_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist direction read"
  ON public.veille_watchlist FOR SELECT
  TO authenticated
  USING (public.is_direction());

CREATE POLICY "watchlist direction write"
  ON public.veille_watchlist FOR ALL
  TO authenticated
  USING (public.is_direction())
  WITH CHECK (public.is_direction());

CREATE TRIGGER update_veille_watchlist_updated_at
  BEFORE UPDATE ON public.veille_watchlist
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS veille_watchlist_actif_prio_idx
  ON public.veille_watchlist (actif, priorite, categorie);

-- Seed initial
INSERT INTO public.veille_watchlist (nom, categorie, priorite, note) VALUES
  -- Fabricants
  ('Stern Pinball', 'fabricants', 1, NULL),
  ('UNIS Technology', 'fabricants', 1, NULL),
  ('Sunflower Amusement', 'fabricants', 2, NULL),
  ('Sacoa Playcard', 'fabricants', 2, 'cashless'),
  ('Semnox', 'fabricants', 2, 'cashless'),
  ('René Pierre', 'fabricants', 2, 'baby-foot FR'),
  ('Stella Baby-Foot', 'fabricants', 3, NULL),
  ('ATARI Pong Table', 'fabricants', 3, NULL),
  ('Jeutel', 'fabricants', 3, NULL),
  -- Concurrents-distributeurs
  ('Bananas Distribution', 'concurrents', 1, NULL),
  ('JADE Jeux Automatiques', 'concurrents', 1, NULL),
  ('LG Jeux', 'concurrents', 2, NULL),
  ('Mass''Automatic', 'concurrents', 2, NULL),
  ('TOP GAME', 'concurrents', 2, NULL),
  ('Loisirs & Technique', 'concurrents', 2, NULL),
  ('dOM-Amusements', 'concurrents', 2, NULL),
  ('Megatec', 'concurrents', 3, 'ES'),
  ('SARL Frouin', 'concurrents', 3, NULL),
  ('Billards et Jeux BMV', 'concurrents', 3, NULL),
  ('My Arcade France', 'concurrents', 3, NULL),
  ('Megarex', 'concurrents', 3, NULL),
  ('Maxipinball', 'concurrents', 3, NULL),
  ('Jeux Montanola', 'concurrents', 3, NULL),
  ('Jeux Argentanais', 'concurrents', 3, NULL),
  ('Family''s Games', 'concurrents', 3, NULL),
  ('Le Grand Jeu', 'concurrents', 3, NULL),
  ('Bitronic', 'concurrents', 3, NULL),
  -- Scène flipper
  ('RB Flip France', 'flipper', 2, NULL),
  ('HEXA Pinball', 'flipper', 2, NULL),
  ('NicoFlip', 'flipper', 3, NULL),
  ('Fliptonic', 'flipper', 3, NULL),
  ('High Voltage Pinball', 'flipper', 3, NULL),
  ('Vintage Legends', 'flipper', 3, NULL),
  ('BIF salon du Flipper', 'flipper', 1, 'salon'),
  ('Festival RetroPlay', 'flipper', 2, 'salon'),
  -- Exploitants-FEC
  ('Games Factory', 'exploitants', 1, NULL),
  ('Speed Park', 'exploitants', 1, NULL),
  ('UP2PLAY', 'exploitants', 1, NULL),
  ('Groupe Monky', 'exploitants', 1, 'client clé'),
  ('Exalto', 'exploitants', 2, NULL),
  ('Hall U Need', 'exploitants', 2, NULL),
  ('Atmos Arena', 'exploitants', 2, NULL),
  ('Laser Game Entertainment', 'exploitants', 2, NULL),
  ('Cosmic Park', 'exploitants', 3, NULL),
  ('Square Games / BattleKart', 'exploitants', 3, NULL),
  ('Follow Park', 'exploitants', 3, NULL),
  ('Fort Boyard Aventures', 'exploitants', 3, NULL),
  ('Prison Island', 'exploitants', 3, NULL),
  ('SENSAS', 'exploitants', 3, NULL),
  ('Royalkids', 'exploitants', 3, NULL),
  ('Tino Land', 'exploitants', 3, NULL),
  ('Game Joy', 'exploitants', 3, NULL),
  ('Planet Park Nantes', 'exploitants', 3, NULL),
  -- TCG / blindbox
  ('Le Gala TCG', 'tcg', 2, NULL),
  ('Manga Story Paris', 'tcg', 2, NULL),
  ('Pokecommunes', 'tcg', 3, NULL),
  ('Planete Jeux Transcards', 'tcg', 3, NULL),
  ('OnlyCards FR', 'tcg', 3, NULL),
  -- Presse
  ('InterGame / InterFun', 'presse', 1, NULL)
ON CONFLICT DO NOTHING;
