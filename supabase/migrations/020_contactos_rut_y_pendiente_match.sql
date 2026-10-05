-- 020_contactos_rut_y_pendiente_match.sql
-- Dos mejoras para el modulo de socios:
--
-- 1) Agregar RUT a los contactos: permite buscar e identificar a la
--    familia por el RUT del padre/madre, no solo por correo. El RUT
--    es mas estable que el correo (los correos cambian; el RUT no).
--
-- 2) Nuevo estado 'pendiente_match' en socio_solicitudes: para los
--    casos en que el apoderado llena el formulario manualmente porque
--    no se encontro a si mismo en el listado del colegio. La solicitud
--    queda sin apoderado_id esperando que la directiva la vincule.

alter table contactos
  add column if not exists rut text;

-- Normalizamos y hacemos el RUT unico (si existe). Permite varios
-- NULLs. Un contacto puede estar en varias familias pero con RUT
-- distinto; en la practica un RUT = una persona.
create unique index if not exists idx_contactos_rut_unique
  on contactos (lower(regexp_replace(rut, '[^0-9kK]', '', 'g')))
  where rut is not null and length(trim(rut)) > 0;

-- Agregar nuevo valor al enum socio_estado. Nota: PostgreSQL permite
-- add value a un enum, pero NO permite agregar en la misma transaccion
-- que se use. Si corres este script dentro de una transaccion unica
-- de Supabase SQL Editor, el nuevo valor queda disponible al final.
do $$ begin
  alter type socio_estado add value if not exists 'pendiente_match';
exception when others then null; end $$;
