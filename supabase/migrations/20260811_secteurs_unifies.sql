-- Un seul découpage commercial, appliqué à toute la base.
--
-- Deux règles coexistaient : le découpage d'origine (Grand Ouest incluant l'Île-de-France)
-- et celui redessiné autour des implantations réelles — Valérie à Avranches, Romain à
-- Paris. L'existant n'a jamais été recalculé après ce changement, si bien que le même
-- département tombait dans deux secteurs selon la date d'import : Paris comptait 141
-- fiches en « nord-ouest » et 104 en « est-sud-est ».
--
-- Les clés sont renommées pour dire ce qu'elles contiennent. « est-sud-est » désignait en
-- réalité l'Île-de-France, le Nord et l'Est — les trois régions les plus denses du fichier,
-- que le nom passait entièrement sous silence.
--
-- Chaque département appartient à un seul secteur, et la France entière est couverte.

update public.prospects
set secteur = case
  -- Grand Ouest — Valérie, basée à Avranches : Normandie, Bretagne, Pays de la Loire.
  when departement in ('14','27','50','61','76',
                       '22','29','35','56',
                       '44','49','53','72','85')
    then 'grand-ouest'

  -- Île-de-France, Nord et Est — Romain, basé à Paris. C'est le secteur le plus dense :
  -- il concentre à lui seul 183 des 239 agences événementielles.
  when departement in ('75','77','78','91','92','93','94','95',
                       '02','59','60','62','80',
                       '08','10','51','52','54','55','57','67','68','88',
                       '21','25','39','58','70','71','89','90')
    then 'idf-nord-est'

  -- Sud et Centre — tout le reste, outre-mer compris.
  when departement is not null then 'sud-centre'
  else null
end;

create index if not exists idx_prospects_secteur on public.prospects (secteur);

comment on column public.prospects.secteur is
  'Secteur commercial déduit du département : grand-ouest (Valérie), idf-nord-est '
  '(Romain), sud-centre. Chaque département appartient à un seul secteur. '
  'À recalculer si les frontières changent — ne jamais laisser deux règles coexister.';
