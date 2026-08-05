-- Briefs de fiche : le paragraphe qui dit au commercial ce qu'il a devant lui.
--
-- Le brief est mis en cache et non recalculé à chaque ouverture. Deux raisons : la
-- latence, un commercial n'attend pas trois secondes devant une fiche ; et le coût,
-- trois commerciaux consultant trente fiches par jour feraient quatre-vingt-dix appels
-- quotidiens pour un texte qui ne change pas d'une heure sur l'autre.
--
-- L'empreinte des faits décide de la péremption : tant que le parc, les ventes et les
-- signaux n'ont pas bougé, le texte reste valable. C'est ce qui distingue un cache
-- d'une simple sauvegarde.

create table if not exists public.fiche_briefs (
  id          uuid primary key default gen_random_uuid(),
  cible_type  text not null check (cible_type in ('prospect', 'client')),
  cible_id    text not null,
  contenu     text not null,
  faits       jsonb,
  empreinte   text,
  genere_le   timestamptz not null default now(),
  genere_par  uuid,
  unique (cible_type, cible_id)
);

create index if not exists idx_fiche_briefs_cible on public.fiche_briefs (cible_type, cible_id);

alter table public.fiche_briefs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'fiche_briefs' and policyname = 'briefs_prospection') then
    create policy "briefs_prospection" on public.fiche_briefs
      for all to authenticated using (can_access_prospection()) with check (can_access_prospection());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fiche_briefs' and policyname = 'copilot_readonly_select') then
    create policy "copilot_readonly_select" on public.fiche_briefs for select to copilot_readonly using (true);
  end if;
end $$;

grant select on public.fiche_briefs to copilot_readonly;
