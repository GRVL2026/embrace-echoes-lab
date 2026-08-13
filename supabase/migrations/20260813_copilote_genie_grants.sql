-- Le copilote génie, partie 1 : lui ouvrir les tables que son cerveau croit déjà voir.
--
-- Le prompt du copilote référence longuement ~28 tables et vues (l'article obligatoire
-- v_gaia_articles, le pipeline, les devis à relancer, le parc client, la veille, les
-- alertes, ses propres revues…) auxquelles le rôle copilot_readonly n'avait AUCUN droit :
-- chaque requête échouait sur « permission denied ». La moitié de son mode d'emploi était
-- donc de la fiction, et la jointure article qu'on lui IMPOSE le renvoyait vers la table
-- gaia_stock explicitement interdite (chiffres faux).
--
-- C'est SANS RISQUE désormais : le copilote est réservé au management (admin, direction,
-- chef_ventes). Une policy copilot_readonly USING(true) n'expose donc rien à un commercial,
-- qui ne peut plus l'invoquer. Le RLS des tables commerciales reste par ailleurs évalué
-- sur l'identité réelle de l'appelant (is_management()).
--
-- Les tables de base que lisent les vues (gaia_ventes, gaia_clients, catalogue_erp…) sont
-- déjà accordées au copilote — vérifié. Il ne manque que les vues et les tables
-- opérationnelles.

-- ── Vues : le grant suffit (une vue n'a pas de RLS propre) ──────────────────────────
grant select on
  public.v_gaia_articles, public.v_gaia_ca_client, public.v_gaia_marge_client,
  public.v_gaia_ca_periode_egale, public.v_gaia_pipeline, public.v_gaia_commandes_etat,
  public.v_gaia_devis_a_relancer, public.v_gaia_parc_client, public.v_gaia_magasin_mensuel,
  public.v_gaia_magasin_top_clients, public.v_gaia_magasin_top_articles,
  public.v_gaia_excluded_clients
to copilot_readonly;
-- ↑ v_gaia_excluded_clients débloque à lui seul quatre vues déjà accordées mais cassées
--   en cascade : v_gaia_ca_mensuel, v_gaia_clients_dormants, v_gaia_marge_famille,
--   v_gaia_magasin_ruptures.

-- ── Tables : grant + policy de lecture pour le rôle copilote ────────────────────────
grant select on
  public.gaia_client_groupes, public.veille_rapports, public.veille_watchlist,
  public.veille_jobs, public.notifications, public.copilot_alertes, public.gaia_revues,
  public.dossier_learning, public.profiles, public.projects, public.logi_expeditions,
  public.stock_sync_log, public.shopify_stats_cache, public.zendesk_stats_cache,
  public.zendesk_ticket_summaries, public.salle_objectifs
to copilot_readonly;

do $$
declare t text;
begin
  -- projects a déjà sa policy copilote : on l'exclut de la boucle.
  foreach t in array array[
    'gaia_client_groupes','veille_rapports','veille_watchlist','veille_jobs',
    'notifications','copilot_alertes','gaia_revues','dossier_learning','profiles',
    'logi_expeditions','stock_sync_log','shopify_stats_cache','zendesk_stats_cache',
    'zendesk_ticket_summaries','salle_objectifs'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'copilot_readonly_select', t);
    execute format(
      'create policy %I on public.%I for select to copilot_readonly using (true)',
      'copilot_readonly_select', t);
  end loop;
end $$;
