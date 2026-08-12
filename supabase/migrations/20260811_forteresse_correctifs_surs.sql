-- Forteresse anti-exfiltration — vague 1 : les correctifs sûrs, sans prérequis de donnée.
--
-- Un audit adverse (équipe rouge) a montré qu'un attaquant ANONYME muni de la seule clé
-- publiable — qui est, par nature, dans le bundle du site — pouvait déjà emporter des
-- choses, et qu'un simple compte authentifié pouvait aspirer bien au-delà de son besoin.
-- Chaque correctif ci-dessous a été VÉRIFIÉ par requête directe sur pg_policies, et
-- aucun ne dépend d'une donnée à peupler ni ne casse un écran existant. Le gros chantier
-- — cloisonner chaque commercial à son portefeuille — est traité à part : il exige une
-- décision de gestion et la population de la colonne propriétaire.

-- 1. STORAGE models-3d : fermer le LISTING anonyme, garder le téléchargement public.
--    C'est le plus gros vol sans aucune clé : un SELECT sur storage.objects autorise à
--    ÉNUMÉRER le bucket (POST /object/list), donc à télécharger les 200 Mo de modèles 3D.
--    Cette policy « lecture publique » avait été posée le 7 août en croyant sécuriser —
--    elle faisait l'inverse. Le partage de dossier /d/:slug n'en dépend PAS : il sert les
--    .glb par getPublicUrl (/object/public/…), qui passe par le drapeau public du bucket
--    et non par cette policy. On la rebranche donc sur les seuls comptes authentifiés.
drop policy if exists "models3d lecture publique" on storage.objects;
create policy "models3d lecture authentifiee" on storage.objects
  for select to authenticated using (bucket_id = 'models-3d');

-- 2. v_cron_jobs : cette vue SECURITY DEFINER déballe à l'anonyme toute l'architecture
--    interne — 14 tâches planifiées, leurs endpoints, leurs horaires, et des secrets que
--    seul un caviardage par expression régulière fragile protège. Aucun front n'en a
--    besoin : on retire l'accès à tout le monde sauf au rôle technique du copilote.
revoke select on public.v_cron_jobs from public;
revoke select on public.v_cron_jobs from anon;
revoke select on public.v_cron_jobs from authenticated;

-- 3. copilot_briefings : la policy « Read briefings authentifies » (USING true) laissait
--    TOUT compte connecté — même sans aucun rôle métier — lire les briefings nominatifs
--    de toute l'équipe : clients, montants, plans d'action. On restreint chacun à son
--    propre briefing ; la direction et l'admin gardent la vue d'ensemble. La carte de
--    briefing du front lit le briefing du jour de l'utilisateur courant : elle continue
--    de fonctionner, en mieux (plus d'ambiguïté entre plusieurs briefings).
drop policy if exists "Read briefings authentifies" on public.copilot_briefings;
create policy "briefings_perimetre" on public.copilot_briefings
  for select to authenticated
  using (user_id = auth.uid() or public.is_direction() or public.is_admin());

-- 4. gaia_equipe : l'annuaire interne (noms, logins des 16 comptes) était lisible par
--    tout compte authentifié via une policy USING true. Aucun écran du front ne le lit.
--    On le réserve aux profils qui ont accès au tableau de bord. La policy d'écriture
--    admin et celle du copilote sont conservées telles quelles.
drop policy if exists "gaia_equipe read authenticated" on public.gaia_equipe;
create policy "gaia_equipe_read_dashboard" on public.gaia_equipe
  for select to authenticated using (public.can_access_dashboard(auth.uid()));

-- 5. catalog_products : la policy « catalog_products_authenticated » accordait ALL
--    (lecture ET écriture) à tout compte authentifié en USING/CHECK true — un compte
--    fraîchement créé, sans aucun rôle, pouvait lire ET modifier ET supprimer le
--    catalogue (prix HT, codes Cegid). On sépare : lecture par les profils du tableau de
--    bord, écriture réservée à la direction et l'admin. La synchro Cegid passe par le
--    service_role, qui ignore la RLS — elle n'est pas affectée.
drop policy if exists "catalog_products_authenticated" on public.catalog_products;
create policy "catalog_products_read" on public.catalog_products
  for select to authenticated using (public.can_access_dashboard(auth.uid()));
create policy "catalog_products_write" on public.catalog_products
  for all to authenticated
  using (public.is_admin() or public.is_direction())
  with check (public.is_admin() or public.is_direction());
