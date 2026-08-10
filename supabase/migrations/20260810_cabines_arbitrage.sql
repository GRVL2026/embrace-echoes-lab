-- Protéger l'arbitrage humain du recalcul automatique.
--
-- Le rapprochement est recalculé à chaque appel de rapprocher-cabines, et l'action
-- « appliquer » écrivait ce calcul par-dessus TOUT — y compris les lignes que Léopaul
-- venait de trancher à la main. Ses cinq rejets du 10 août auraient disparu au premier
-- relancement, sans le moindre avertissement.
--
-- La table arcade_salles avait déjà cette colonne pour cette raison exacte ; son absence
-- ici est un oubli, pas un choix.
--
-- Une fois posée, la règle est simple : ce qui porte une date d'arbitrage n'est plus
-- touché par la machine. L'humain a le dernier mot, et il le garde.

alter table public.cabines_photo
  add column if not exists arbitre_le timestamptz;

comment on column public.cabines_photo.arbitre_le is
  'Date à laquelle un humain a tranché le rapprochement de cette cabine. Non nul = '
  'le recalcul automatique ne doit plus y toucher.';

create index if not exists idx_cabines_arbitrees
  on public.cabines_photo (arbitre_le) where arbitre_le is not null;

-- Les cinq galeries marchandes rejetées le 10 août 2026 : la cabine était dans le
-- centre commercial, l'établissement trouvé était un de ses locataires. Deux
-- exploitants, deux interlocuteurs. On horodate ces décisions rétroactivement, sinon
-- le premier « appliquer » les effacerait.
update public.cabines_photo
set arbitre_le = now()
where rapprochement = 'aucun'
  and arbitre_le is null
  and nom in (
    'Carrousel du Louvre', 'Confluence', 'Apsys - Rives de l''Orne',
    'Steel', 'Duval - La Ville du Bois'
  );
