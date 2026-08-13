-- Le copilote génie, partie 2 : lui donner accès aux tables commerciales de base.
--
-- DÉCOUVERTE CLÉ. Le copilote exécute son SQL via le client service_role (gaia-copilot →
-- admin.rpc('gaia_query')), donc à l'intérieur, auth.uid() est NULL. Toute policy basée
-- sur l'identité de l'appelant — can_access_prospection(), is_management(),
-- can_access_dashboard() — renvoie donc FAUX pour le copilote, quel que soit l'utilisateur
-- réel. Il ne lit que les tables dont la policy copilot_readonly est USING(true).
--
-- Conséquences observées : prospects (policy USING can_access_prospection()) renvoyait 0 ;
-- gaia_clients / gaia_ventes / gaia_historique / catalogue_erp n'avaient AUCUNE policy
-- copilote → 0 également. Le copilote se rabattait sur les seules vues matérialisées.
--
-- POURQUOI USING(true) EST SÛR ICI. La protection du copilote n'est pas la RLS (aveugle,
-- auth.uid() NULL) mais le VERROU D'INVOCATION de l'edge function, désormais réservé au
-- management (admin, direction, chef_ventes). Un commercial ne peut pas invoquer le
-- copilote ; le management, lui, a de toute façon accès à tout. L'accès direct des humains
-- aux tables reste, lui, gardé par is_management() sur leur vraie identité — inchangé.

drop policy if exists "copilot_readonly_select" on public.prospects;
create policy "copilot_readonly_select" on public.prospects
  for select to copilot_readonly using (true);

drop policy if exists "copilot_readonly_select" on public.gaia_clients;
create policy "copilot_readonly_select" on public.gaia_clients
  for select to copilot_readonly using (true);

drop policy if exists "copilot_readonly_select" on public.gaia_ventes;
create policy "copilot_readonly_select" on public.gaia_ventes
  for select to copilot_readonly using (true);

drop policy if exists "copilot_readonly_select" on public.gaia_historique;
create policy "copilot_readonly_select" on public.gaia_historique
  for select to copilot_readonly using (true);

drop policy if exists "copilot_readonly_select" on public.catalogue_erp;
create policy "copilot_readonly_select" on public.catalogue_erp
  for select to copilot_readonly using (true);
