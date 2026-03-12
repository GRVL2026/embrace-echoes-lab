INSERT INTO storage.buckets (id, name, public)
VALUES ('models-3d', 'models-3d', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access on models-3d"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'models-3d');

CREATE POLICY "Public upload access on models-3d"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'models-3d');

CREATE POLICY "Public delete access on models-3d"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'models-3d');