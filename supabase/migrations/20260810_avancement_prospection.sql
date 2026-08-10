-- Avancement de la distribution, agrégé par département.
--
-- L'écran a besoin de savoir, secteur par secteur, ce qui est distribué, ce qui reste en
-- réserve, et ce qui n'est pas encore joignable. Compter côté navigateur supposerait de
-- lire les neuf mille fiches — or PostgREST en rend mille au maximum, quelle que soit la
-- limite demandée. C'est ce plafond silencieux qui avait vidé le menu des segments de la
-- carte : la requête réussissait, le résultat était tronqué, et rien ne le signalait.
--
-- Une centaine de lignes suffisent donc ici, une par département, et la page recompose
-- les secteurs à partir de là.
--
-- security_invoker = true est ESSENTIEL : sans lui la vue s'exécuterait avec les droits
-- de son propriétaire et contournerait la RLS des prospects.

create or replace view public.v_prospection_avancement
with (security_invoker = true) as
select
  coalesce(secteur, '(sans secteur)')      as secteur,
  coalesce(departement, '??')              as departement,
  count(*)                                 as total,
  count(*) filter (where joignable)        as joignables,
  -- « Distribué » ne se compte que parmi les joignables : une fiche sans coordonnée n'a
  -- jamais eu vocation à être servie, l'inclure ferait paraître le travail en retard
  -- alors qu'il ne peut pas commencer.
  count(*) filter (where joignable and etat = 'actif')  as distribues,
  count(*) filter (where joignable and etat = 'vivier') as en_reserve,
  count(*) filter (where not joignable)    as injoignables
from public.prospects
group by 1, 2;

comment on view public.v_prospection_avancement is
  'Avancement de la distribution par département : distribué / en réserve / injoignable. '
  'Agrégé en base pour contourner le plafond de 1000 lignes de PostgREST.';

grant select on public.v_prospection_avancement to authenticated;
grant select on public.v_prospection_avancement to copilot_readonly;
