-- Rendre le territoire exploitable : code postal et département sur toutes les fiches.
--
-- Huit mille prospects sur neuf mille n'avaient pas de code postal — le fichier NAF le
-- laissait dans le champ adresse, sous la forme « BOULEVARD DES ALLIES 94500 CHAMPIGNY ».
-- Sans lui, aucun découpage par secteur n'est possible : ni attribution à un commercial,
-- ni regroupement en tournée, ni comptage par région.
--
-- On extrait le DERNIER groupe de cinq chiffres de l'adresse, et non le premier : un
-- numéro de rue ne fait jamais cinq chiffres en France, mais l'ancrage en fin de chaîne
-- reste plus sûr, le code postal précédant toujours la commune dans ce format.
--
-- Contrôle de vraisemblance passé avant écriture : 7 933 codes extraits sur 7 968, et
-- les départements majoritaires sont la Vendée, la Charente-Maritime, le Var et
-- l'Hérault — la géographie exacte du camping français. Les 35 échecs sont des adresses
-- « [NON-DIFFUSIBLE] », que l'INSEE masque à la demande de l'entreprise ; elles gardent
-- leur commune et seront résolues par géocodage.

alter table public.prospects
  add column if not exists departement text;

update public.prospects
set code_postal = (regexp_match(adresse, '\m(\d{5})\M(?!.*\m\d{5}\M)'))[1]
where code_postal is null
  and adresse is not null
  and adresse <> '[NON-DIFFUSIBLE]';

-- Le département se déduit du code postal, à deux exceptions près qu'un simple
-- « deux premiers caractères » traiterait mal :
--   • l'outre-mer tient sur trois chiffres (971 Guadeloupe … 976 Mayotte) ;
--   • la Corse n'a pas de numéro, mais deux lettres — 2A au sud, 2B au nord.
update public.prospects
set departement = case
  when code_postal is null then null
  when left(code_postal, 2) in ('97', '98') then left(code_postal, 3)
  when left(code_postal, 2) = '20' then
    case when code_postal ~ '^\d{5}$' and code_postal::int < 20200 then '2A' else '2B' end
  else left(code_postal, 2)
end
where departement is distinct from case
  when code_postal is null then null
  when left(code_postal, 2) in ('97', '98') then left(code_postal, 3)
  when left(code_postal, 2) = '20' then
    case when code_postal ~ '^\d{5}$' and code_postal::int < 20200 then '2A' else '2B' end
  else left(code_postal, 2)
end;

-- C'est la colonne sur laquelle se feront tous les regroupements par secteur.
create index if not exists idx_prospects_departement on public.prospects (departement);

comment on column public.prospects.departement is
  'Département déduit du code postal (3 caractères en outre-mer, 2A/2B en Corse). '
  'Sert au découpage des secteurs commerciaux et au regroupement des tournées.';
