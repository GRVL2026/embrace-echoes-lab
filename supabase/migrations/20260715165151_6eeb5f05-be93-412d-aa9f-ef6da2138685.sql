CREATE TABLE public.copilote_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  question text not null,
  reponse text not null,
  requetes_sql jsonb not null default '[]'::jsonb,
  note smallint not null check (note in (-1, 1)),
  commentaire text,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.copilote_feedback TO authenticated;
GRANT ALL ON public.copilote_feedback TO service_role;
ALTER TABLE public.copilote_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "direction reads feedback" ON public.copilote_feedback FOR SELECT TO authenticated USING (public.is_direction());
CREATE POLICY "direction inserts feedback" ON public.copilote_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND public.is_direction());