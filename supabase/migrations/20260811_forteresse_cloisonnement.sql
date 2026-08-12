-- Forteresse anti-exfiltration — vague 2 : le cloisonnement.
--
-- ⚠️ NE PAS EXÉCUTER avant d'avoir confirmé que le compte du dirigeant porte le rôle
-- 'admin' OU 'direction'. Ces policies réservent l'accès à ces deux rôles ; si le compte
-- exploitant en est dépourvu, il se verrouille lui-même hors de sa propre base.
--
-- Ce que ça change : aujourd'hui un simple compte 'commercial' ou 'prospection' lit la
-- TOTALITÉ des tables — 9 289 prospects, 3 008 clients, 21 832 ventes, ~185 000 commandes —
-- par simple pagination avec la clé publiable. Un seul mot de passe suffisait à tout
-- emporter. Après cette migration : la direction voit tout ; un commercial ne voit que
-- les fiches prospects qui lui sont ASSIGNÉES (proprietaire = son identifiant), et plus
-- rien d'autre. Les tables Cegid (clients, ventes, commandes, stock) deviennent réservées
-- à la direction, en attendant que la colonne propriétaire y soit peuplée (tâche « capter
-- le propriétaire ») pour un cloisonnement par portefeuille.
--
-- Le copilote (rôle technique copilot_readonly) garde ses propres policies : il continue
-- de tout lire. Les edge functions passent par le service_role, qui ignore la RLS : le
-- partage de dossier /d/:slug et la carte ne sont pas affectés.

-- ── prospects : direction pleine, commercial limité à SES fiches assignées ──────────
drop policy if exists "prospects prospection all" on public.prospects;

create policy "prospects_direction_all" on public.prospects
  for all to authenticated
  using (public.is_admin() or public.is_direction())
  with check (public.is_admin() or public.is_direction());

-- Un commercial ne voit QUE son portefeuille. Tant que rien ne lui est assigné
-- (proprietaire NULL), il ne voit rien — ce qui est le comportement voulu aujourd'hui.
-- Le jour où la distribution lui assigne des fiches, elles apparaissent sans nouvelle
-- migration. Il ne voit jamais le vivier entier ni les fiches des autres.
create policy "prospects_commercial_read_own" on public.prospects
  for select to authenticated
  using (proprietaire = auth.uid());

create policy "prospects_commercial_update_own" on public.prospects
  for update to authenticated
  using (proprietaire = auth.uid())
  with check (proprietaire = auth.uid());

-- ── prospect_events : même logique, rattachée au propriétaire du prospect ───────────
drop policy if exists "prospect_events prospection all" on public.prospect_events;

create policy "prospect_events_direction_all" on public.prospect_events
  for all to authenticated
  using (public.is_admin() or public.is_direction())
  with check (public.is_admin() or public.is_direction());

create policy "prospect_events_commercial_own" on public.prospect_events
  for all to authenticated
  using (exists (
    select 1 from public.prospects p
    where p.id = prospect_events.prospect_id and p.proprietaire = auth.uid()))
  with check (exists (
    select 1 from public.prospects p
    where p.id = prospect_events.prospect_id and p.proprietaire = auth.uid()));

-- ── Tables Cegid : réservées à la direction (pas de propriétaire encore) ────────────
-- On remplace la lecture élargie 'can_access_dashboard' par 'admin OU direction'. Les
-- writes de ces tables passent par le service_role (synchro Cegid) : non concernés.
--
-- POINT DÉLICAT — le rôle « public » et non « authenticated ». La policy d'origine
-- « dashboard read » visait le rôle public, ce qui la faisait s'appliquer AUSSI au rôle
-- technique du copilote (copilot_readonly) lorsqu'il lit ces tables. gaia_clients et
-- gaia_ventes n'ont PAS de policy copilote dédiée — elles ne tenaient QUE par là. En
-- restant sur « to public », le copilote conserve exactement le même chemin de lecture,
-- évalué sur l'identité réelle de l'appelant : plein pour l'admin, fermé pour un
-- commercial. Passer à « to authenticated » aurait coupé le copilote de ces deux tables.
drop policy if exists "dashboard read" on public.gaia_clients;
create policy "gaia_clients_direction_read" on public.gaia_clients
  for select to public using (public.is_admin() or public.is_direction());

drop policy if exists "dashboard read" on public.gaia_ventes;
create policy "gaia_ventes_direction_read" on public.gaia_ventes
  for select to public using (public.is_admin() or public.is_direction());

drop policy if exists "dashboard read" on public.gaia_commandes;
create policy "gaia_commandes_direction_read" on public.gaia_commandes
  for select to public using (public.is_admin() or public.is_direction());

drop policy if exists "dashboard read" on public.gaia_stock;
create policy "gaia_stock_direction_read" on public.gaia_stock
  for select to public using (public.is_admin() or public.is_direction());
