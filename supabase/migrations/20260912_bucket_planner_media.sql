-- Arcade Planner — bucket des médias de rendu (vues photoréalistes générées, sprites bakés).
-- Lecture publique (les vues s'affichent dans le dossier client / le partage par lien) ;
-- écriture réservée au service_role (l'edge generer-vue et les scripts d'upload offline).

INSERT INTO storage.buckets (id, name, public)
VALUES ('planner-media', 'planner-media', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique explicite du bucket.
DROP POLICY IF EXISTS planner_media_lecture ON storage.objects;
CREATE POLICY planner_media_lecture ON storage.objects
  FOR SELECT
  USING (bucket_id = 'planner-media');

-- Pas de policy INSERT/UPDATE/DELETE : seul le service_role (qui contourne la RLS)
-- peut écrire — via l'edge generer-vue ou un script d'upload local disposant de la clé.
