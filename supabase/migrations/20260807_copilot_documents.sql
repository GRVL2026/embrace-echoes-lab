-- Documents produits par le copilote.
--
-- Le copilote continue de répondre librement : rien ne change à sa façon de réfléchir.
-- Mais quand le sujet le mérite — une question large, plusieurs sources croisées, une
-- décision à prendre — il PROPOSE d'en faire un document. C'est l'utilisateur qui
-- déclenche. Imposer une structure à chaque réponse le rendrait bête sur les questions
-- courtes ; ne jamais en proposer laisserait sa réflexion se perdre dans le fil.
--
-- Le contenu est stocké en JSON plutôt qu'en Markdown : le document porte des chiffres,
-- des séries de graphiques et une liste de prospects priorisée, qui doivent rester
-- exploitables — pour le rendu, l'export PDF, et pour rouvrir la carte sur les bons
-- points. Du texte mis en forme ne le permettrait pas.

create table if not exists public.copilot_documents (
  id          uuid primary key default gen_random_uuid(),
  titre       text not null,
  -- La demande d'origine, telle qu'elle a été formulée. Elle sert à retrouver un
  -- document des semaines plus tard, quand le titre ne suffit plus à se rappeler
  -- pourquoi on l'avait demandé.
  sujet       text,
  contenu     jsonb not null,
  modele      text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_copilot_documents_recents
  on public.copilot_documents (created_at desc);

alter table public.copilot_documents enable row level security;

-- Même périmètre que les revues commerciales : ces documents croisent le chiffre
-- d'affaires, les marges et le portefeuille client.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'copilot_documents'
      and policyname = 'documents direction'
  ) then
    create policy "documents direction" on public.copilot_documents
      for all to authenticated using (is_direction()) with check (is_direction());
  end if;
end $$;

comment on table public.copilot_documents is
  'Documents structurés produits par le copilote sur proposition, jamais automatiquement. '
  'contenu : { resume, sections[], graphiques[], actions[], prospects[], carte } — les '
  'sections vides sont omises plutôt que rendues vides.';
