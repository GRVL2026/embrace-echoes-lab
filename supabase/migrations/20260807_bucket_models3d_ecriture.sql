-- Bucket models-3d : fermer l'écriture, garder la lecture ouverte.
--
-- Le bucket acceptait un dépôt de fichier de n'importe qui : la clé publiable est dans
-- le code du site, il suffisait de la lire pour y téléverser ce qu'on voulait.
--
-- MAIS LA LECTURE DOIT RESTER PUBLIQUE. Les modèles 3D sont servis par getPublicUrl
-- (BulkModel3DDialog, ProductDialog, sketchfab-search) et s'affichent notamment dans les
-- dossiers partagés par lien, consultés par des clients qui ne sont pas connectés.
-- Fermer la lecture ferait disparaître les modèles de ces pages.
--
-- Les écritures légitimes ne sont pas touchées : celles du navigateur viennent des pages
-- éditeur, donc d'un utilisateur authentifié ; celle de l'edge function sketchfab-search
-- passe par le service_role, qui n'est pas soumis à la RLS.

do $$
declare p record;
begin
  -- On ne retire que les politiques d'ÉCRITURE propres à ce bucket. Le filtre sur le
  -- nom du bucket dans la définition évite de toucher une politique partagée avec
  -- d'autres buckets, qu'on casserait sans le voir.
  for p in
    select policyname, cmd from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd <> 'SELECT'
      and roles::text[] && array['public', 'anon']
      and coalesce(qual, '') || coalesce(with_check, '') like '%models-3d%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
    raise notice 'Politique d''écriture publique retirée : %', p.policyname;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'models3d ecriture authentifiee'
  ) then
    create policy "models3d ecriture authentifiee" on storage.objects
      for all to authenticated
      using (bucket_id = 'models-3d')
      with check (bucket_id = 'models-3d');
  end if;

  -- La lecture publique est explicitée plutôt que supposée : si le bucket cesse un jour
  -- d'être marqué « public », les dossiers partagés continueront de fonctionner.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'models3d lecture publique'
  ) then
    create policy "models3d lecture publique" on storage.objects
      for select to public
      using (bucket_id = 'models-3d');
  end if;
end $$;
