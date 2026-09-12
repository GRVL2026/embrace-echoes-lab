-- Cockpit prospection — distribution des news (Gazette) à un commercial.
-- Tristan distribue un signal → il apparaît dans le cockpit de Romain / Valérie.

-- 1) Destinataire sur le signal.
ALTER TABLE public.gazette_signaux
  ADD COLUMN IF NOT EXISTS assigne_a uuid,
  ADD COLUMN IF NOT EXISTS assigne_le timestamptz,
  ADD COLUMN IF NOT EXISTS assigne_par uuid;

CREATE INDEX IF NOT EXISTS idx_gazette_signaux_assigne_a ON public.gazette_signaux (assigne_a);

-- 2) Un commercial peut lire les signaux qui LUI sont distribués
--    (s'ajoute aux policies management existantes — les policies sont en OU).
DROP POLICY IF EXISTS gazette_lecture_assignee ON public.gazette_signaux;
CREATE POLICY gazette_lecture_assignee ON public.gazette_signaux
  FOR SELECT TO authenticated
  USING (assigne_a = auth.uid());

-- 3) Distribution : réservé au management (Tristan/direction), assigne un signal à un commercial.
CREATE OR REPLACE FUNCTION public.assigner_signal(_signal_id uuid, _commercial uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.gazette_signaux
     SET assigne_a = _commercial, assigne_le = now(), assigne_par = auth.uid()
   WHERE id = _signal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assigner_signal(uuid, uuid) TO authenticated;
