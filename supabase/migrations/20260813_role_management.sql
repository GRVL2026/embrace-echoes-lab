-- Un vrai niveau « management » : admin + direction + chef_ventes.
--
-- Le modèle de rôles a quatre niveaux (admin, direction, chef_ventes, commercial), mais
-- la forteresse et les écrans ne reconnaissaient comme « voit tout » que admin et
-- direction. chef_ventes (Tristan, qui distribue les leads et pilote l'équipe) tombait
-- dans une faille : il pouvait convoquer le copilote mais ne voyait ni la distribution,
-- ni la Gazette, ni un seul prospect ou client. Léopaul veut qu'il soit un manager de
-- plein exercice — comme il lui a ouvert le copilote, qui lit tout.
--
-- On introduit is_management() et on bascule dessus toutes les policies qui disaient
-- « is_admin() OR is_direction() ». Les commerciaux (Romain Lirola, Valérie) restent hors
-- management : leur cloisonnement à leurs propres fiches est inchangé.

create or replace function public.is_management(_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _uid and role in ('admin', 'direction', 'chef_ventes')
  );
$$;

comment on function public.is_management is
  'Vrai pour admin, direction ET chef_ventes — le tier « voit tout » de la maison. '
  'IMMUTABLE côté logique ; utilisée dans les policies RLS et exécutable par le copilote.';

-- Le copilote (copilot_readonly) et les utilisateurs doivent pouvoir l'exécuter, sinon
-- toute policy qui l'appelle plante sur « permission denied » — la leçon de is_admin.
grant execute on function public.is_management(uuid) to public, anon, authenticated, copilot_readonly;

-- ── Bascule des policies « voit tout » ─────────────────────────────────────────────

-- prospects : le management voit et gère tout ; le commercial reste sur ses fiches.
drop policy if exists "prospects_direction_all" on public.prospects;
create policy "prospects_management_all" on public.prospects
  for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- prospect_events
drop policy if exists "prospect_events_direction_all" on public.prospect_events;
create policy "prospect_events_management_all" on public.prospect_events
  for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Tables Cegid (rôle « public » pour couvrir le copilote, cf. vague 2)
drop policy if exists "gaia_clients_direction_read" on public.gaia_clients;
create policy "gaia_clients_management_read" on public.gaia_clients
  for select to public using (public.is_management());

drop policy if exists "gaia_ventes_direction_read" on public.gaia_ventes;
create policy "gaia_ventes_management_read" on public.gaia_ventes
  for select to public using (public.is_management());

drop policy if exists "gaia_commandes_direction_read" on public.gaia_commandes;
create policy "gaia_commandes_management_read" on public.gaia_commandes
  for select to public using (public.is_management());

drop policy if exists "gaia_stock_direction_read" on public.gaia_stock;
create policy "gaia_stock_management_read" on public.gaia_stock
  for select to public using (public.is_management());

drop policy if exists "gaia_achats read direction" on public.gaia_achats;
create policy "gaia_achats_management_read" on public.gaia_achats
  for select to public using (public.is_management());

-- Gazette : lecture et écriture au management — Tristan y accède enfin.
drop policy if exists "gazette_lecture" on public.gazette_signaux;
create policy "gazette_lecture" on public.gazette_signaux
  for select to authenticated using (public.is_management());
drop policy if exists "gazette_ecriture" on public.gazette_signaux;
create policy "gazette_ecriture" on public.gazette_signaux
  for update to authenticated using (public.is_management()) with check (public.is_management());

-- Briefing du jour de l'entreprise
drop policy if exists "briefings_direction" on public.copilot_briefings;
create policy "briefings_management" on public.copilot_briefings
  for select to authenticated using (public.is_management());

-- Écriture du parc et du catalogue
drop policy if exists "arcade_salles_write" on public.arcade_salles;
create policy "arcade_salles_write" on public.arcade_salles
  for all to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists "cabines_write" on public.cabines_photo;
create policy "cabines_write" on public.cabines_photo
  for all to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists "catalog_products_write" on public.catalog_products;
create policy "catalog_products_write" on public.catalog_products
  for all to authenticated
  using (public.is_management()) with check (public.is_management());
