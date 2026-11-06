-- v2 · Fotos en Notas y Recordatorios.
-- Crea un espacio privado de archivos ("adjuntos") donde cada quien solo ve sus fotos (carpeta = su user id)
-- y agrega una columna images (lista de rutas) a notes y reminders. No borra ni cambia datos. Se puede correr más de una vez.

-- 1) Bucket privado, máx. 10 MB por foto, solo imágenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos', 'adjuntos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 2) Cada quien solo puede ver, subir y borrar dentro de su propia carpeta: adjuntos/<su user id>/…
drop policy if exists "adjuntos own read" on storage.objects;
create policy "adjuntos own read" on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "adjuntos own insert" on storage.objects;
create policy "adjuntos own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "adjuntos own update" on storage.objects;
create policy "adjuntos own update" on storage.objects for update to authenticated
  using (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "adjuntos own delete" on storage.objects;
create policy "adjuntos own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'adjuntos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Rutas de las fotos de cada nota / recordatorio.
alter table public.notes add column if not exists images text[] not null default '{}';
alter table public.reminders add column if not exists images text[] not null default '{}';
-- Una nota puede ser solo foto (sin texto).
alter table public.notes alter column content drop not null;

-- Verificación: el bucket (privado), 4 políticas y 2 columnas.
select 'bucket' as que, id as nombre, case when public then 'PÚBLICO' else 'privado' end as detalle from storage.buckets where id = 'adjuntos'
union all
select 'política', policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'adjuntos own%'
union all
select 'columna', table_name, column_name from information_schema.columns where table_schema = 'public' and column_name = 'images' and table_name in ('notes', 'reminders');
