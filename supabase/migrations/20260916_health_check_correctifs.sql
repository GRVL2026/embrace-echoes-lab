-- Correctifs appliqués le 16/09/2026 (health-check quotidien).
--
-- ⚠️ Ces instructions ont été exécutées à la main dans l'éditeur SQL de Lovable.
-- Ce fichier existe pour qu'elles soient TRACÉES dans le dépôt : sur Lovable Cloud,
-- le mot de passe de la base n'est pas distribué, donc le SQL ne peut pas être
-- appliqué depuis le dépôt. Sans ce fichier, un changement collé à la main est
-- invisible de l'historique — c'est ce qui est arrivé au correctif btrim, appliqué
-- en base mais absent de git, et donc perdu si Lovable régénère les fonctions.

-- 1. Fermer les fonctions SECURITY DEFINER exécutables par l'anonyme.
--    Le privilège venait d'un GRANT à PUBLIC (proacl : "=X/postgres"), pas à `anon` :
--    un REVOKE ... FROM anon seul était INOPÉRANT.
--    `authenticated` et `service_role` gardent leur GRANT explicite.
revoke execute on function public.get_briefing_ca()                         from public, anon;
revoke execute on function public.get_briefing_activite_hebdo()             from public, anon;
revoke execute on function public.get_client_ca_par_type(text[], integer)   from public, anon;
revoke execute on function public.get_client_ventes_lignes(text[], integer) from public, anon;
revoke execute on function public.assigner_signal(uuid, uuid)               from public, anon;
revoke execute on function public.is_management(uuid)                       from public, anon;

-- 2. Arrêter les crons de la campagne camping, terminée (768 appels/jour pour rien).
select cron.unschedule('camping-enrichir-osm');
select cron.unschedule('camping-emails-sites');

-- 3. Programmer l'audit d'hygiène du catalogue Shopify (lundis 6 h UTC).
--    Le secret est lu dans gaia_config plutôt qu'écrit en dur : la commande du job
--    reste propre, et une rotation du CRON_SECRET n'oblige pas à réécrire le job.
select cron.schedule(
  'audit-catalogue-hebdo',
  '0 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://yhfghipueqfkgysaulvl.supabase.co/functions/v1/audit-catalogue',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select value from public.gaia_config where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- 4. Ouvrir au copilote la photo quotidienne du carnet (36 jours d'historique).
--    Prérequis du détecteur `reliquats_gonflement` de copilot-sentinel : mesurer un
--    gonflement exige un historique, que v_gaia_carnet_documents ne fournit pas.
grant select on public.gaia_carnet_snapshot to copilot_readonly;
drop policy if exists copilot_readonly_select on public.gaia_carnet_snapshot;
create policy copilot_readonly_select
  on public.gaia_carnet_snapshot for select
  to copilot_readonly
  using (true);

-- 5. L'apprentissage du jour (copilot_learnings) a également été inséré ce jour-là.
--    Il n'est pas repris ici : c'est une donnée, pas une structure.
