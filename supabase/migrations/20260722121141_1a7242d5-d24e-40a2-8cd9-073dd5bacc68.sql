
ALTER TABLE public.copilot_messages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'copilot_messages_status_check') THEN
    ALTER TABLE public.copilot_messages
      ADD CONSTRAINT copilot_messages_status_check CHECK (status IN ('generating','done','error'));
  END IF;
END $$;

-- Realtime : émettre les UPDATE avec l'ancienne + nouvelle ligne complètes
ALTER TABLE public.copilot_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'copilot_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_messages';
  END IF;
END $$;
