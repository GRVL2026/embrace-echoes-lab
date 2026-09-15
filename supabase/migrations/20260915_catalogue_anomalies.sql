-- Hygiène du catalogue : fiches Shopify dont le champ `custom.specs_dimensions` est
-- illisible, incomplet ou aberrant. Ces cotes se propagent dans l'Arcade Planner, les
-- devis et les dossiers commerciaux : une valeur fausse fausse tout en aval.
--
-- Remplie par l'edge function `audit-catalogue`, qui repart d'une table vide à chaque
-- passage : une fiche corrigée disparaît d'elle-même du rapport.

create table if not exists public.catalogue_anomalies (
  shopify_id     text primary key,
  titre          text not null,
  handle         text,
  statut         text,
  valeur_brute   text,
  notation       text,            -- mm (notation machine) | cm (notation accessoire) | null
  anomalie       text not null,   -- manquant | illisible | axe_manquant | hors_plage
                                  -- | intervalle | ordre_inhabituel | incoherence_variante
  gravite        text not null,   -- bloquant (cotes inexploitables) | cosmetique
  detail         text,
  largeur_mm     numeric,
  profondeur_mm  numeric,
  hauteur_mm     numeric,
  vu_le          timestamptz not null default now()
);

comment on table public.catalogue_anomalies is
  'Fiches Shopify dont les cotes sont inexploitables. Rempli par l''edge function audit-catalogue.';

create index if not exists catalogue_anomalies_gravite_idx
  on public.catalogue_anomalies (gravite, anomalie);

alter table public.catalogue_anomalies enable row level security;

-- Lecture réservée au management (admin, direction, chef_ventes).
drop policy if exists catalogue_anomalies_lecture on public.catalogue_anomalies;
create policy catalogue_anomalies_lecture
  on public.catalogue_anomalies for select
  to authenticated
  using (public.is_management());

-- Écriture : uniquement le service_role, via l'edge function. Aucune policy pour
-- `authenticated` en insert/update/delete — c'est volontaire.

-- Le copilote lecture seule doit pouvoir la consulter pour en rendre compte.
grant select on public.catalogue_anomalies to copilot_readonly;
drop policy if exists copilot_readonly_select on public.catalogue_anomalies;
create policy copilot_readonly_select
  on public.catalogue_anomalies for select
  to copilot_readonly
  using (true);
