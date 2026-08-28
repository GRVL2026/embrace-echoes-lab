-- Copilote génie, partie 3 : le débloquer sur l'analyse financière et sa propre mémoire.
--
-- LEVIER n°1 — gaia_config. C'est une table clé/valeur (2 colonnes), mais v_gaia_lignes —
-- colonne vertébrale de TOUTE analyse CA/marge/stock — la lit. Sans accès à gaia_config,
-- le copilote se prenait « permission denied for gaia_config » sur toute question chiffrée,
-- et même les vues déjà accordées restaient aveugles. L'ouvrir débloque la chaîne entière.
--
-- Puis les 13 vues analytiques (marge, coût, CA par famille, stock, ancienneté) et la
-- mémoire propre du copilote (apprentissages, briefings, documents, mémoire persistante,
-- retours). Sûr : le copilote est réservé au management. On écarte volontairement les logs
-- de conversation bruts (copilot_conversations/messages/user_profiles) : aucun intérêt
-- analytique, et ils n'ont pas à être relus.

-- ── Vues analytiques : le grant suffit (pas de RLS propre) ──────────────────────────
grant select on
  public.v_gaia_lignes_marge, public.v_gaia_magasin_marge, public.v_gaia_cout_article,
  public.v_gaia_ca_famille, public.v_gaia_article_famille,
  public.v_gaia_stock_valeur, public.v_gaia_stock_dormant, public.v_gaia_magasin_stock_valeur,
  public.v_gaia_magasin_carnet, public.v_gaia_magasin_sous_familles,
  public.v_gaia_client_anciennete, public.v_gaia_ecotaxe_mensuel, public.v_gaia_retrocession_sfa
to copilot_readonly;

-- ── Tables : grant + policy de lecture copilote ────────────────────────────────────
grant select on
  public.gaia_config,
  public.copilot_learnings, public.copilot_briefings, public.copilot_documents,
  public.copilote_memoire, public.copilote_feedback
to copilot_readonly;

do $$
declare t text;
begin
  foreach t in array array[
    'gaia_config','copilot_learnings','copilot_briefings','copilot_documents',
    'copilote_memoire','copilote_feedback'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'copilot_readonly_select', t);
    execute format(
      'create policy %I on public.%I for select to copilot_readonly using (true)',
      'copilot_readonly_select', t);
  end loop;
end $$;
