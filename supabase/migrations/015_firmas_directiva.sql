-- 015_firmas_directiva.sql
-- Cada miembro de la directiva puede tener una firma escaneada guardada en
-- Supabase Storage (bucket "firmas"). La ruta relativa se guarda en la
-- columna firma_path. Cuando se emite un acta o certificado, el sistema
-- carga la firma correspondiente y la superpone sobre la linea del cargo.

alter table directiva_miembros
  add column if not exists firma_path text;

-- Bucket privado para las firmas escaneadas.
insert into storage.buckets (id, name, public)
values ('firmas', 'firmas', false)
on conflict (id) do nothing;

-- Politicas: solo la directiva puede leer, subir y borrar firmas.
drop policy if exists firmas_directiva_select on storage.objects;
drop policy if exists firmas_directiva_insert on storage.objects;
drop policy if exists firmas_directiva_delete on storage.objects;

create policy firmas_directiva_select on storage.objects
  for select using (bucket_id = 'firmas' and is_directiva());
create policy firmas_directiva_insert on storage.objects
  for insert with check (bucket_id = 'firmas' and is_directiva());
create policy firmas_directiva_delete on storage.objects
  for delete using (bucket_id = 'firmas' and is_directiva());
