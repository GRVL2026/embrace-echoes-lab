-- L'avancement se lit par ACTIVITÉ avant de se lire par région.
--
-- « Grand Ouest : 971 fiches » ne dit rien d'exploitable : six cent douze campings et
-- trois cent cinquante-neuf salles d'arcade, ce sont deux métiers, deux argumentaires,
-- deux saisons. Un commercial ne prépare pas la même journée.
--
-- On ajoute donc le segment à la maille. Cent départements par quatre segments restent
-- très en deçà du plafond de mille lignes de PostgREST, et la page recompose ce qu'elle
-- veut : le total par activité, puis la répartition par secteur une fois l'activité
-- choisie.

create or replace view public.v_prospection_avancement
with (security_invoker = true) as
select
  coalesce(secteur, '(sans secteur)')      as secteur,
  coalesce(departement, '??')              as departement,
  coalesce(segment, 'autre')               as segment,
  count(*)                                 as total,
  count(*) filter (where joignable)        as joignables,
  count(*) filter (where joignable and etat = 'actif')  as distribues,
  count(*) filter (where joignable and etat = 'vivier') as en_reserve,
  count(*) filter (where not joignable)    as injoignables
from public.prospects
group by 1, 2, 3;

comment on view public.v_prospection_avancement is
  'Avancement de la distribution par secteur × département × activité : distribué / en '
  'réserve / injoignable. Agrégé en base pour contourner le plafond de 1000 lignes de '
  'PostgREST.';

grant select on public.v_prospection_avancement to authenticated;
grant select on public.v_prospection_avancement to copilot_readonly;
