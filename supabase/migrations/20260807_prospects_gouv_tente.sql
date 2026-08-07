-- Marqueur de tentative d'enrichissement par l'API publique des entreprises.
--
-- Sans lui, un enrichissement par lots ne sait pas distinguer « pas encore essayé » de
-- « essayé, rien trouvé » : les mêmes fiches introuvables reviendraient à chaque appel
-- et les suivantes ne seraient jamais tentées.
--
-- On ne peut pas réutiliser prepare_at, qui signifie autre chose : « fiche préparée par
-- l'agent, accroche rédigée, prête à partir ». L'écrire ici ferait apparaître comme
-- préparées des fiches qui ne le sont pas.

alter table public.prospects
  add column if not exists gouv_tente_at timestamptz;

comment on column public.prospects.gouv_tente_at is
  'Date de la dernière interrogation de recherche-entreprises.api.gouv.fr pour cette fiche, '
  'qu''elle ait abouti ou non. Ne dit rien de la qualité du résultat : un SIRET nul avec '
  'une date renseignée signifie « cherché, pas trouvé » ou « plusieurs sociétés possibles ».';

-- L'enrichissement lit toujours « les fiches d'une source, pas encore tentées ».
create index if not exists idx_prospects_gouv_a_faire
  on public.prospects (source) where gouv_tente_at is null;
