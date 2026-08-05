-- Annuaire des salles d'arcade : socle d'intégration et de croisement.
--
-- L'objectif n'est pas d'ajouter une source de plus, mais d'ENRICHIR les fiches
-- existantes. D'où deux principes tenus dès la première ligne :
--   1. une fiche par établissement, reconnaissable par une empreinte stable ;
--   2. la source est cumulable, jamais un silo — un lieu trouvé par l'annuaire ET
--      par la presse ET par l'import NAF doit rester UNE fiche, mieux renseignée.
--
-- Sans ces deux règles, chaque nouvelle source dupliquerait au lieu d'enrichir.

-- ── Empreinte de rapprochement ───────────────────────────────────────────────
-- Nom normalisé + ville : accents, ponctuation, casse et espaces disparaissent,
-- « Bowling de l'Océan » et « BOWLING DE L OCEAN » se rejoignent. Immuable, donc
-- utilisable en colonne générée et en index.
create or replace function public.empreinte_etablissement(nom text, lieu text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           lower(translate(coalesce(nom, ''),
                 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')),
           '[^a-z0-9]+', '', 'g')
      || '|' ||
         regexp_replace(
           lower(translate(coalesce(lieu, ''),
                 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')),
           '[^a-z0-9]+', '', 'g');
$$;

-- ── Règles 1 et 2 appliquées aux prospects ───────────────────────────────────
alter table public.prospects
  add column if not exists code_postal text,
  add column if not exists sources text[] not null default '{}';

-- Colonne générée : l'empreinte ne peut pas se désynchroniser du nom.
alter table public.prospects
  add column if not exists empreinte text
  generated always as (public.empreinte_etablissement(entreprise, ville)) stored;

create index if not exists idx_prospects_empreinte on public.prospects (empreinte);

-- La source unique existante devient le premier élément de la liste.
update public.prospects
   set sources = array[source]
 where source is not null and sources = '{}';

-- ── Catalogue des machines recensées par l'annuaire ──────────────────────────
-- 887 jeux et 189 flippers. Le rapprochement avec le catalogue Avranches
-- Automatic est porté ICI, une fois par modèle, et non salle par salle : un
-- arbitrage validé vaut pour les huit cents salles d'un coup.
create table if not exists public.arcade_machines (
  slug              text primary key,
  nom               text not null,
  categorie         text,          -- 'jeu' | 'flipper'
  type_jeu          text,          -- Course, Rail Shooter, Simulation, Jeux forains…
  editeur           text,
  annee             smallint,
  nb_joueurs        smallint,
  fiche_url         text,
  -- Rapprochement catalogue. « marque » signifie : modèle absent du catalogue mais
  -- éditeur que nous distribuons — donc dans notre périmètre commercial.
  code_article      text,
  famille_aa        text,
  correspondance    text check (correspondance in ('exacte', 'marque', 'aucune', 'a_confirmer')),
  correspondance_par text check (correspondance_par in ('auto', 'humain')),
  vu_le             timestamptz not null default now()
);

create index if not exists idx_arcade_machines_corresp on public.arcade_machines (correspondance);
create index if not exists idx_arcade_machines_editeur on public.arcade_machines (editeur);

-- ── Les salles ───────────────────────────────────────────────────────────────
create table if not exists public.arcade_salles (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  fiche_url     text not null,
  nom           text,
  adresse       text,
  code_postal   text,
  ville         text,
  departement   text,
  region        text,
  site_web      text,
  facebook      text,
  instagram     text,
  lat           numeric,
  lng           numeric,
  geocode_at    timestamptz,
  -- Rapprochement avec l'existant. Jamais automatique quand il est douteux :
  -- « a_confirmer » attend un arbitrage humain plutôt que de fusionner à tort.
  empreinte     text generated always as (public.empreinte_etablissement(nom, ville)) stored,
  prospect_id   uuid references public.prospects(id) on delete set null,
  code_client   text,
  rapprochement text check (rapprochement in ('client', 'prospect', 'a_confirmer', 'aucun')),
  -- Horodatage de lecture de la fiche : NULL = à lire. Renseigné même en cas
  -- d'échec définitif, pour ne pas boucler indéfiniment sur les mêmes pages.
  fiche_lue_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_arcade_salles_empreinte on public.arcade_salles (empreinte);
create index if not exists idx_arcade_salles_a_lire on public.arcade_salles (fiche_lue_at) where fiche_lue_at is null;
create index if not exists idx_arcade_salles_dept on public.arcade_salles (departement);

-- ── Le parc : qui possède quoi ───────────────────────────────────────────────
-- C'est cette table qui fait toute la valeur. Sans elle on a un annuaire ; avec
-- elle on peut demander « les salles de Bretagne à plus de six machines et sans
-- aucun flipper ».
create table if not exists public.arcade_parc (
  salle_id     uuid not null references public.arcade_salles(id) on delete cascade,
  machine_slug text not null references public.arcade_machines(slug) on delete cascade,
  vu_le        timestamptz not null default now(),
  primary key (salle_id, machine_slug)
);

create index if not exists idx_arcade_parc_machine on public.arcade_parc (machine_slug);

-- ── Sécurité ─────────────────────────────────────────────────────────────────
-- Même modèle que les prospects : accès par can_access_prospection(), plus une
-- politique dédiée au rôle de lecture du copilote. Le GRANT seul ne suffit pas,
-- la policy est indispensable.
alter table public.arcade_machines enable row level security;
alter table public.arcade_salles   enable row level security;
alter table public.arcade_parc     enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'arcade_machines' and policyname = 'arcade_machines_prospection') then
    create policy "arcade_machines_prospection" on public.arcade_machines
      for all to authenticated using (can_access_prospection()) with check (can_access_prospection());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'arcade_salles' and policyname = 'arcade_salles_prospection') then
    create policy "arcade_salles_prospection" on public.arcade_salles
      for all to authenticated using (can_access_prospection()) with check (can_access_prospection());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'arcade_parc' and policyname = 'arcade_parc_prospection') then
    create policy "arcade_parc_prospection" on public.arcade_parc
      for all to authenticated using (can_access_prospection()) with check (can_access_prospection());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'arcade_machines' and policyname = 'copilot_readonly_select') then
    create policy "copilot_readonly_select" on public.arcade_machines for select to copilot_readonly using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'arcade_salles' and policyname = 'copilot_readonly_select') then
    create policy "copilot_readonly_select" on public.arcade_salles for select to copilot_readonly using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'arcade_parc' and policyname = 'copilot_readonly_select') then
    create policy "copilot_readonly_select" on public.arcade_parc for select to copilot_readonly using (true);
  end if;
end $$;

grant select on public.arcade_machines, public.arcade_salles, public.arcade_parc to copilot_readonly;

-- ── Type de lieu ─────────────────────────────────────────────────────────────
-- Les 819 adresses ne sont pas 819 « salles d'arcade » : ce sont des bowlings, des
-- campings, des cinémas, des casinos. Sans cette distinction, le copilote de la carte
-- ne peut répondre ni « les campings de Bretagne » ni « les bowlings sans flipper ».
--
-- Une salle porte souvent PLUSIEURS prestations — bowling avec bar et laser game — d'où
-- le tableau conservé en entier, et un type principal dérivé du plus spécifique.
alter table public.arcade_salles
  add column if not exists type_lieu   text,
  add column if not exists prestations text[] not null default '{}';

create index if not exists idx_arcade_salles_type on public.arcade_salles (type_lieu);
create index if not exists idx_arcade_salles_prestations on public.arcade_salles using gin (prestations);

-- ── Vues d'agrégation ────────────────────────────────────────────────────────
-- Le client ne sait pas grouper : ces vues portent les regroupements dont l'écran
-- « Parc installé » a besoin, et le copilote les interroge avec le même vocabulaire.
-- security_invoker : la vue s'exécute avec les droits de l'appelant, donc la RLS des
-- tables sous-jacentes continue de s'appliquer — sans quoi la vue serait une porte
-- dérobée autour des politiques qu'on vient d'écrire.

create or replace view public.v_arcade_modeles
with (security_invoker = true) as
  select m.slug, m.nom, m.categorie, m.type_jeu, m.editeur, m.annee,
         m.code_article, m.famille_aa, m.correspondance,
         count(p.salle_id)::int as salles
    from public.arcade_machines m
    left join public.arcade_parc p on p.machine_slug = m.slug
   group by m.slug, m.nom, m.categorie, m.type_jeu, m.editeur, m.annee,
            m.code_article, m.famille_aa, m.correspondance;

create or replace view public.v_arcade_salles_parc
with (security_invoker = true) as
  select s.id, s.slug, s.nom, s.ville, s.code_postal, s.departement, s.region,
         s.type_lieu, s.prestations, s.lat, s.lng, s.site_web, s.facebook,
         s.fiche_url, s.fiche_lue_at, s.prospect_id, s.code_client, s.rapprochement,
         count(p.machine_slug)::int as nb_machines,
         min(mm.annee)                as parc_annee_min,
         round(avg(mm.annee))::int    as parc_annee_moyenne,
         count(*) filter (where mm.categorie = 'flipper')::int as nb_flippers
    from public.arcade_salles s
    left join public.arcade_parc p on p.salle_id = s.id
    left join public.arcade_machines mm on mm.slug = p.machine_slug
   group by s.id;

grant select on public.v_arcade_modeles, public.v_arcade_salles_parc to copilot_readonly;

-- ── Établissements fermés ────────────────────────────────────────────────────
-- L'annuaire signale les fermetures dans le nom du lieu — « Bowling Alma Loisirs
-- Rennes Fermeture definitive ». Trente-sept lieux sont concernés. Les laisser dans
-- le lot reviendrait à faire appeler des rideaux baissés, et à compter dans le parc
-- installé des machines qui n'existent plus.
alter table public.arcade_salles
  add column if not exists ferme boolean not null default false;

update public.arcade_salles
   set ferme = true
 where nom ~* '(fermeture|ferm[ée]e? d[ée]finitiv|d[ée]finitivement ferm)';

create index if not exists idx_arcade_salles_ouvertes on public.arcade_salles (ferme) where ferme = false;

-- ── Le candidat proposé, pour rendre l'arbitrage possible ────────────────────
-- « À confirmer » sans dire À QUOI ne se tranche pas : il faut le nom du candidat,
-- son identité et le motif du rapprochement — distance, similarité — pour décider
-- d'un coup d'œil.
alter table public.arcade_salles
  add column if not exists candidat_type  text check (candidat_type in ('client', 'prospect')),
  add column if not exists candidat_id    text,
  add column if not exists candidat_nom   text,
  add column if not exists candidat_motif text,
  add column if not exists arbitre_le     timestamptz,
  add column if not exists arbitre_par    uuid;

create index if not exists idx_arcade_salles_a_arbitrer
  on public.arcade_salles (rapprochement) where rapprochement = 'a_confirmer';

-- ── Résumé du parc, par lieu ─────────────────────────────────────────────────
-- La bulle de la carte doit dire en trois chiffres ce qu'un lieu a chez lui, sans
-- charger dix mille lignes dans le navigateur. La part de notre catalogue est le
-- chiffre le plus parlant : elle mesure ce qui se joue chez ce lieu, indépendamment
-- de savoir qui le lui a vendu.
create or replace view public.v_arcade_parc_resume
with (security_invoker = true) as
  select s.id                as salle_id,
         s.code_client,
         s.prospect_id,
         s.nom,
         s.type_lieu,
         count(p.machine_slug)::int                                                   as nb_machines,
         count(*) filter (where m.categorie = 'flipper')::int                          as nb_flippers,
         count(*) filter (where m.correspondance in ('exacte', 'marque'))::int         as nb_catalogue,
         round(avg(m.annee))::int                                                      as annee_moyenne
    from public.arcade_salles s
    join public.arcade_parc p on p.salle_id = s.id
    join public.arcade_machines m on m.slug = p.machine_slug
   where s.ferme = false
   group by s.id, s.code_client, s.prospect_id, s.nom, s.type_lieu;

grant select on public.v_arcade_parc_resume to copilot_readonly;
