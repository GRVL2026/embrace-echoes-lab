-- Conversations du copilote (par utilisateur)
CREATE TABLE public.copilot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titre text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_conversations TO authenticated;
GRANT ALL ON public.copilot_conversations TO service_role;
ALTER TABLE public.copilot_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON public.copilot_conversations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_copilot_conversations_user_updated
  ON public.copilot_conversations(user_id, updated_at DESC);

-- Messages des conversations
CREATE TABLE public.copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.copilot_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  contenu text NOT NULL,
  steps jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_messages TO authenticated;
GRANT ALL ON public.copilot_messages TO service_role;
ALTER TABLE public.copilot_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversation messages" ON public.copilot_messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.copilot_conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.copilot_conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  ));
CREATE INDEX idx_copilot_messages_conv ON public.copilot_messages(conversation_id, created_at);

-- Trigger updated_at
CREATE TRIGGER update_copilot_conversations_updated_at
  BEFORE UPDATE ON public.copilot_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();