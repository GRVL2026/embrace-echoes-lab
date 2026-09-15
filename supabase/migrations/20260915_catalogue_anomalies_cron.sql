-- Cron hebdomadaire de l'audit catalogue : tous les lundis à 6 h 00 (heure serveur, UTC).
-- Tourne côté Supabase, donc indépendamment du Mac de Léopaul.
--
-- PRÉREQUIS avant de coller :
--   1. l'edge function `audit-catalogue` est déployée
--   2. le secret `CRON_SECRET` existe (déjà utilisé par envoi-brief-matin, cegid-sync…)
--   3. remplacer <CRON_SECRET> ci-dessous par sa valeur réelle
--
-- pg_net et pg_cron doivent être activés (ils le sont déjà, geocoder-daily les utilise).

select cron.unschedule('audit-catalogue-hebdo')
  where exists (select 1 from cron.job where jobname = 'audit-catalogue-hebdo');

select cron.schedule(
  'audit-catalogue-hebdo',
  '0 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://yhfghipueqfkgysaulvl.supabase.co/functions/v1/audit-catalogue',
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-cron-secret',  '<CRON_SECRET>'
               ),
    body    := '{}'::jsonb
  );
  $$
);
