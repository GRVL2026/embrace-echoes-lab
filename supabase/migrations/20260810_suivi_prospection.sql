-- Suivi de la prospection, agrégé par commercial.
--
-- Quatre nombres, et un seul compte vraiment : SANS PROCHAINE ACTION. Un lead en retard
-- se voit — il porte une date passée, il remonte, on le rattrape. Un lead sans date ne
-- se voit nulle part : personne ne l'a abandonné, personne ne s'en occupe, et il
-- disparaît sans que rien ne le signale. C'est exactement la crainte formulée le
-- 10 août — « avoir tellement de prospects qu'on loupe beaucoup de choses » — et c'est
-- le seul indicateur qui la détecte.
--
-- Agrégé en base pour la même raison que l'avancement : PostgREST plafonne toute
-- lecture à mille lignes, sans le dire.

create or replace view public.v_suivi_prospection
with (security_invoker = true) as
select
  proprietaire,
  count(*)                                                          as actifs,
  count(*) filter (where prochaine_action_le < current_date)        as en_retard,
  count(*) filter (where prochaine_action_le is null)               as sans_action,
  count(*) filter (where distribue_le >= date_trunc('week', now())) as servis_semaine,
  -- « Traité » ne veut pas dire « gagné » : cela veut dire que quelqu'un l'a fait
  -- bouger. Un lead passé en « perdu » a été travaillé, et compte donc au rendement.
  count(*) filter (where statut <> 'nouveau'
                     and updated_at >= date_trunc('week', now()))   as traites_semaine,
  -- Servi il y a plus d'un mois et jamais touché : il vaut mieux le rendre à la réserve
  -- que le laisser encombrer un pipeline où il ne sera plus jamais regardé.
  count(*) filter (where statut = 'nouveau'
                     and distribue_le < now() - interval '30 days') as a_rendre,
  max(distribue_le)                                                 as dernier_service
from public.prospects
where etat = 'actif'
group by 1;

comment on view public.v_suivi_prospection is
  'Suivi hebdomadaire par commercial : charge, retards, fiches sans prochaine action, '
  'rendement de la semaine, dormants à rendre au vivier.';

grant select on public.v_suivi_prospection to authenticated;
grant select on public.v_suivi_prospection to copilot_readonly;
