-- Cabines photo installées en France : la carte d'implantation d'un concurrent.
--
-- Avranches Automatic s'apprête à distribuer le Photoma Mini d'Apple Industries. La
-- page « trouver une cabine » de Tabobine recense trois cent trente et un lieux qui
-- ont DÉJÀ accepté une cabine photo — donc qui ont déjà répondu à l'objection « ça
-- n'intéresse pas ma clientèle ». Le même raisonnement que pour l'annuaire arcade :
-- ce sont des acheteurs avérés, pas des suspects.
--
-- ⚠️ Cette liste est celle d'un CONCURRENT. Un lieu qui y figure est équipé, donc
-- indisponible dans l'immédiat — sa valeur est le renouvellement, la comparaison, et
-- surtout ce qu'elle apprend du marché réel : ni bowlings ni cinémas, mais des bars
-- urbains, des centres commerciaux et des chaînes de restauration.

create table if not exists public.cabines_photo (
  id            uuid primary key default gen_random_uuid(),
  exploitant    text not null default 'Tabobine',   -- le concurrent qui l'a posée
  nom           text not null,
  adresse       text,
  code_postal   text,
  ville         text,
  pays          text not null default 'FR',   -- le concurrent déborde en Belgique et en Italie
  departement   text,
  region        text,
  lat           numeric,
  lng           numeric,
  geocode_at    timestamptz,
  geocode_score numeric,                            -- fiabilité rendue par l'API adresse
  -- Rapprochement avec l'existant, même logique que l'annuaire arcade.
  empreinte     text generated always as (public.empreinte_etablissement(nom, ville)) stored,
  prospect_id   uuid references public.prospects(id) on delete set null,
  code_client   text,
  salle_id      uuid references public.arcade_salles(id) on delete set null,
  rapprochement text check (rapprochement in ('client', 'prospect', 'a_confirmer', 'aucun')),
  releve_le     timestamptz not null default now(),
  unique (exploitant, nom, adresse)
);

create index if not exists idx_cabines_empreinte on public.cabines_photo (empreinte);
create index if not exists idx_cabines_dept on public.cabines_photo (departement);
create index if not exists idx_cabines_a_geocoder on public.cabines_photo (geocode_at) where geocode_at is null;

alter table public.cabines_photo enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cabines_photo' and policyname = 'cabines_prospection') then
    create policy "cabines_prospection" on public.cabines_photo
      for all to authenticated using (can_access_prospection()) with check (can_access_prospection());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cabines_photo' and policyname = 'copilot_readonly_select') then
    create policy "copilot_readonly_select" on public.cabines_photo for select to copilot_readonly using (true);
  end if;
end $$;

grant select on public.cabines_photo to copilot_readonly;
