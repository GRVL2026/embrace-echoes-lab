-- =====================================================================
-- DOSSIER CLIENT — couche données
-- Greffe sur Arcade Planner : marques, modules de contenu réutilisables,
-- et dossiers client (projets commerciaux).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. price_monthly sur le catalogue (distinguer vente vs location/leasing)
-- ---------------------------------------------------------------------
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS price_monthly numeric;

COMMENT ON COLUMN public.catalog_products.price_monthly IS
  'Loyer indicatif par mois (location / leasing). price = prix de vente HT.';

-- ---------------------------------------------------------------------
-- 2. brands — Avranches Automatic, Funtime, Hypernova
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,           -- 'avranches' | 'funtime' | 'hypernova'
  name        text NOT NULL,
  tagline     text,
  pitch       text,
  color       text,                            -- couleur primaire (hex)
  accent      text,                            -- couleur d'accent (hex)
  logo_url    text,
  contact     jsonb NOT NULL DEFAULT '{}',      -- { phone, email, website, sites }
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3. brand_modules — blocs de contenu réutilisables (issus des présentations)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  type        text NOT NULL,                    -- societe | equipe | chiffres | univers | services |
                                                --  partenaires | acquisition | pourquoi | contact |
                                                --  projet | gamme | marche | argumentaire ...
  slug        text NOT NULL,
  title       text,
  subtitle    text,
  content     jsonb NOT NULL DEFAULT '{}',      -- { body, points[], stats[], ... } — souple
  position    integer NOT NULL DEFAULT 0,       -- ordre d'affichage
  reusable    boolean NOT NULL DEFAULT true,    -- proposable dans un dossier
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_brand_modules_brand ON public.brand_modules (brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_modules_type  ON public.brand_modules (type);

ALTER TABLE public.brand_modules ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 4. projects — un dossier client (le livrable des commerciaux)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  client_name       text NOT NULL DEFAULT '',
  client_contact    text,
  offer             text NOT NULL DEFAULT 'vente',   -- vente | location | leasing
  brief             text,                             -- le message initial du commercial (langage naturel)

  context           jsonb NOT NULL DEFAULT '{}',      -- { contexte, objectif, enjeux, lecture }
  solution          jsonb NOT NULL DEFAULT '{}',      -- { selection, deploiement, suivi }
  selected_products jsonb NOT NULL DEFAULT '[]',      -- [ { product_id, name, qty, unit_price, edition } ]
  selected_modules  jsonb NOT NULL DEFAULT '[]',      -- [ brand_module_id, ... ] (ordonné)
  scope             jsonb NOT NULL DEFAULT '{}',      -- cases périmètre { fourniture, livraison, formation, garantie }
  pricing           jsonb NOT NULL DEFAULT '{}',      -- { lines[], total_ht, monthly }

  plan_data         jsonb,                            -- snapshot d'agencement (rooms/doors/pillars/placedEquipments…)
  plan_snapshot_id  uuid REFERENCES public.layout_snapshots(id) ON DELETE SET NULL,

  share_slug        text UNIQUE,                      -- pour le lien public /d/:slug
  share_token       text,                             -- jeton de lecture
  is_shared         boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'draft',    -- draft | sent | won | lost
  created_by        text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_brand      ON public.projects (brand_id);
CREATE INDEX IF NOT EXISTS idx_projects_status     ON public.projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_share_slug ON public.projects (share_slug);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 5. RLS — ⚠️ permissif pour rester cohérent avec l'app actuelle (pas d'auth).
--    À RESSERRER avant de mettre de vrais noms de clients derrière un lien
--    partagé : lecture publique limitée à projects filtrée par token,
--    écriture réservée aux commerciaux authentifiés.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['brands','brand_modules','projects'] LOOP
    EXECUTE format('CREATE POLICY "Public read %1$s"   ON public.%1$I FOR SELECT TO public USING (true);', t);
    EXECUTE format('CREATE POLICY "Public insert %1$s" ON public.%1$I FOR INSERT TO public WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "Public update %1$s" ON public.%1$I FOR UPDATE TO public USING (true) WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "Public delete %1$s" ON public.%1$I FOR DELETE TO public USING (true);', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. Triggers updated_at (réutilise public.update_updated_at_column() déjà créé)
-- ---------------------------------------------------------------------
CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_brand_modules_updated_at
  BEFORE UPDATE ON public.brand_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
