-- Trace des interrogations de Google Places.
--
-- Même rôle que email_tente_at : sans horodatage, les fiches muettes reviennent à chaque
-- passage et bloquent la progression. Ici l'enjeu est en plus financier — chaque requête
-- est facturée, et reposer indéfiniment la même question coûte de l'argent pour rien.

alter table public.prospects
  add column if not exists google_tente_at timestamptz,
  -- L'identifiant de la fiche Google. C'est la seule donnée que les conditions de Places
  -- autorisent à conserver sans limite de durée ; elle permet de retrouver
  -- l'établissement plus tard sans repayer une recherche.
  add column if not exists google_place_id text;

create index if not exists idx_prospects_google_a_faire
  on public.prospects (google_tente_at) where google_tente_at is null;

comment on column public.prospects.google_tente_at is
  'Date de la dernière interrogation de Google Places, aboutie ou non. Évite de repayer '
  'la même recherche.';
