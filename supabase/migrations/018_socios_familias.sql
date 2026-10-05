-- 018_socios_familias.sql
-- Integra el modulo de socios con las tablas existentes de apoderados,
-- contactos y estudiantes. El flujo real es: todas las familias
-- matriculadas ya existen en apoderados (cargadas desde el Excel del
-- colegio); las que pagan la cuota del periodo quedan marcadas como
-- socias.

-- 1) Linkear cada solicitud al apoderado existente. Nullable porque
--    puede haber solicitudes antiguas sin apoderado identificado.
alter table socio_solicitudes
  add column if not exists apoderado_id uuid references apoderados(id) on delete set null;

create index if not exists idx_socio_solicitudes_apoderado
  on socio_solicitudes (apoderado_id);

-- 2) Guardar el periodo (año) en el que el apoderado se hizo socio.
--    Permite distinguir "socio activo del periodo actual" vs "fue socio
--    el periodo pasado pero no renovo". Nullable: si es null, el campo
--    "socio" bool antiguo se interpreta como info sin año conocido.
alter table apoderados
  add column if not exists socio_periodo int;

create index if not exists idx_apoderados_socio_periodo
  on apoderados (socio, socio_periodo);

-- 3) Backfill opcional: si hay solicitudes "enviada" sin apoderado_id,
--    intentar linkearlas con el apoderado cuyo contacto tiene el mismo
--    email. No fallamos si no se encuentra.
update socio_solicitudes s
set apoderado_id = sub.apoderado_id
from (
  select distinct on (lower(c.email))
    lower(c.email) as email,
    c.apoderado_id
  from contactos c
  where c.email is not null and length(trim(c.email)) > 0
  order by lower(c.email), c.created_at
) sub
where s.apoderado_id is null
  and lower(s.apoderado_email) = sub.email;

-- 4) Backfill de socio_periodo: para las familias que tienen una
--    solicitud "enviada" con apoderado_id, propagar el periodo a la
--    tabla apoderados.
update apoderados a
set socio_periodo = sub.periodo_anio,
    socio = true
from (
  select distinct on (apoderado_id)
    apoderado_id,
    periodo_anio
  from socio_solicitudes
  where estado = 'enviada'
    and apoderado_id is not null
  order by apoderado_id, periodo_anio desc
) sub
where a.id = sub.apoderado_id;
