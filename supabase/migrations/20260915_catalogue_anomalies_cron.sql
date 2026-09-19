-- Cron hebdomadaire de l'audit catalogue : lundis 6 h 00 UTC.
--
-- ⚠️ CIBLE : le nouveau projet `dkoroqqvfyjmkaoidwzq` (cf. docs/migration-hors-lovable.md).
-- Ce fichier visait initialement l'instance Lovable `yhfghipueqfkgysaulvl` ; il a été repointé
-- le 19/09/2026. Ne pas le rejouer sur l'ancienne instance : l'audit n'y sera jamais utilisé,
-- la bascule intervient avant la mi-novembre.
--
-- PRÉREQUIS, à vérifier AVANT de poser le cron :
--   1. les secrets `SHOPIFY_ACCESS_TOKEN` et `SHOPIFY_SHOP_DOMAIN` sont posés sur le projet
--      (au 19/09 ils ne le sont PAS — la fonction répondrait 500 chaque lundi, en silence) ;
--   2. l'audit a été déclenché à la main AU MOINS UNE FOIS avec succès. On ne planifie pas
--      ce qu'on n'a jamais vu fonctionner.
--
-- Le secret se lit dans `gaia_config`, comme `shopify-stats-refresh`, plutôt qu'écrit en dur.

select cron.unschedule('audit-catalogue-hebdo')
  where exists (select 1 from cron.job where jobname = 'audit-catalogue-hebdo');

select cron.schedule(
  'audit-catalogue-hebdo',
  '0 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://dkoroqqvfyjmkaoidwzq.supabase.co/functions/v1/audit-catalogue',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', (select value from public.gaia_config where key = 'cron_secret')
               ),
    body    := '{}'::jsonb
  );
  $$
);
