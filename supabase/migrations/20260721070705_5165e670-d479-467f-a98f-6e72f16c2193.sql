
-- Table d'état pour la synchro Cegid (singleton, id=1)
CREATE TABLE IF NOT EXISTS public.cegid_sync_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  queue TEXT[],
  feed TEXT,
  skip INT NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.cegid_sync_state TO service_role;
ALTER TABLE public.cegid_sync_state ENABLE ROW LEVEL SECURITY;
-- Aucun policy : accès uniquement via service_role (bypass RLS).

INSERT INTO public.cegid_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Verrou atomique pour l'action 'step' du cegid-sync.
CREATE OR REPLACE FUNCTION public.cegid_sync_try_lock(_ttl_seconds INT DEFAULT 100)
RETURNS public.cegid_sync_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cegid_sync_state;
BEGIN
  UPDATE public.cegid_sync_state
  SET locked_until = now() + make_interval(secs => _ttl_seconds),
      updated_at   = now()
  WHERE id = 1
    AND (locked_until IS NULL OR locked_until < now())
  RETURNING * INTO r;
  RETURN r;
END $$;

GRANT EXECUTE ON FUNCTION public.cegid_sync_try_lock(INT) TO service_role;
