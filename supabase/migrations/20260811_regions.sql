-- La région remplace les « grands ensembles » commerciaux.
--
-- Un secteur inventé est une convention, et une convention se change : j'en ai redessiné
-- les frontières deux fois dans la même journée, sans recalculer l'existant, si bien que
-- Paris s'est retrouvé dans deux secteurs à la fois. Une région administrative, elle, ne
-- se discute pas.
--
-- Elle est CALCULÉE et non stockée à la main : une colonne générée ne peut pas diverger
-- de sa source, quelle que soit la fonction d'import qui écrit la fiche. C'est la leçon
-- de la journée, inscrite dans le schéma plutôt que dans un commentaire.

create or replace function public.region_depuis_departement(dep text)
returns text language sql immutable as $$
  select case
    when dep is null then null
    when dep in ('75','77','78','91','92','93','94','95')                          then 'Île-de-France'
    when dep in ('18','28','36','37','41','45')                                    then 'Centre-Val de Loire'
    when dep in ('21','25','39','58','70','71','89','90')                          then 'Bourgogne-Franche-Comté'
    when dep in ('14','27','50','61','76')                                         then 'Normandie'
    when dep in ('02','59','60','62','80')                                         then 'Hauts-de-France'
    when dep in ('08','10','51','52','54','55','57','67','68','88')                then 'Grand Est'
    when dep in ('44','49','53','72','85')                                         then 'Pays de la Loire'
    when dep in ('22','29','35','56')                                              then 'Bretagne'
    when dep in ('16','17','19','23','24','33','40','47','64','79','86','87')      then 'Nouvelle-Aquitaine'
    when dep in ('09','11','12','30','31','32','34','46','48','65','66','81','82') then 'Occitanie'
    when dep in ('01','03','07','15','26','38','42','43','63','69','73','74')      then 'Auvergne-Rhône-Alpes'
    when dep in ('04','05','06','13','83','84')                                    then 'Provence-Alpes-Côte d''Azur'
    when dep in ('2A','2B')                                                        then 'Corse'
    when left(dep, 2) in ('97','98')                                               then 'Outre-mer'
    else null
  end
$$;

comment on function public.region_depuis_departement is
  'Région administrative d''un département. IMMUTABLE, donc utilisable dans une colonne '
  'générée — c''est ce qui garantit qu''aucun import ne pourra la contredire.';

alter table public.prospects
  add column if not exists region text
    generated always as (public.region_depuis_departement(departement)) stored;

create index if not exists idx_prospects_region on public.prospects (region);

-- Le secteur n'a plus de raison d'être : c'est lui qui portait les deux règles
-- contradictoires. On le retire plutôt que de le laisser mentir en silence.
drop view if exists public.v_prospection_avancement;
alter table public.prospects drop column if exists secteur;

create view public.v_prospection_avancement
with (security_invoker = true) as
select
  coalesce(region, '(région inconnue)') as region,
  coalesce(departement, '??')           as departement,
  coalesce(segment, 'autre')            as segment,
  count(*)                                              as total,
  count(*) filter (where joignable)                     as joignables,
  count(*) filter (where joignable and etat = 'actif')  as distribues,
  count(*) filter (where joignable and etat = 'vivier') as en_reserve,
  count(*) filter (where not joignable)                 as injoignables
from public.prospects
group by 1, 2, 3;

grant select on public.v_prospection_avancement to authenticated;
grant select on public.v_prospection_avancement to copilot_readonly;
