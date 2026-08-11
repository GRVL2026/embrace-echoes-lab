-- Qui reçoit des leads.
--
-- L'écran de distribution listait TOUS les comptes : direction, comptes de test et
-- commerciaux mêlés. Sept cartes pour trois personnes qui portent réellement un
-- portefeuille — et autant d'occasions de servir la mauvaise ligne un lundi matin.
--
-- On l'exprime par un indicateur explicite plutôt que par un rôle : Tristan distribue
-- les leads sans en porter, et Léopaul administre l'outil sans prospecter. Aucun rôle
-- existant ne décrit « porteur de portefeuille », c'est une notion commerciale et non
-- une permission.

alter table public.profiles
  add column if not exists recoit_des_leads boolean not null default false;

comment on column public.profiles.recoit_des_leads is
  'Vrai pour les commerciaux qui portent un portefeuille. Seuls ceux-là apparaissent '
  'dans l''écran de distribution. Ni une permission ni un rôle : une réalité commerciale.';

update public.profiles
set recoit_des_leads = true
where full_name ilike '%tristan%ramos%'
   or full_name ilike '%romain%lirola%'
   or full_name ilike '%leneveu%';
