-- =============================================================================
-- Migración 001: separar estudiantes de apoderados
--
-- Corre este script UNA VEZ en Supabase SQL Editor. Idempotente.
-- =============================================================================

-- Dropear la vista primero (depende de la columna curso que vamos a eliminar)
drop view if exists v_cuota_estado_apoderado;

-- Nueva tabla estudiantes
create table if not exists estudiantes (
  id uuid primary key default gen_random_uuid(),
  apoderado_id uuid not null references apoderados(id) on delete cascade,
  nombre text not null,
  curso text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudiantes_apoderado on estudiantes (apoderado_id);
create index if not exists idx_estudiantes_curso on estudiantes (curso);

-- Migrar datos existentes de apoderados.nombre_estudiante → estudiantes
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='apoderados' and column_name='nombre_estudiante'
  ) then
    insert into estudiantes (apoderado_id, nombre, curso, activo)
    select a.id, a.nombre_estudiante, a.curso, a.activo
    from apoderados a
    where a.nombre_estudiante is not null and a.nombre_estudiante <> '';
  end if;
end $$;

-- Sacar columnas obsoletas de apoderados
alter table apoderados drop column if exists nombre_estudiante;
alter table apoderados drop column if exists curso;
drop index if exists idx_apoderados_curso;

-- Recrear la vista con la nueva estructura (cursos agregados desde estudiantes)
create or replace view v_cuota_estado_apoderado as
select
  a.id as apoderado_id,
  a.nombre,
  (
    select string_agg(coalesce(e.curso, '—'), ', ' order by e.curso)
    from estudiantes e
    where e.apoderado_id = a.id and e.activo
  ) as curso,
  p.id as periodo_id,
  p.nombre as periodo,
  p.monto as monto_periodo,
  coalesce(cp.monto_pagado, 0)::numeric as pagado,
  coalesce(cp.estado, 'pendiente'::cuota_estado) as estado
from apoderados a
cross join cuota_periodos p
left join cuota_pagos cp on cp.apoderado_id = a.id and cp.periodo_id = p.id
where a.activo and p.activa;

-- RLS de estudiantes
alter table estudiantes enable row level security;
drop policy if exists estudiantes_directiva_all on estudiantes;
drop policy if exists estudiantes_self_select on estudiantes;
create policy estudiantes_directiva_all on estudiantes
  for all using (is_directiva()) with check (is_directiva());
create policy estudiantes_self_select on estudiantes
  for select using (apoderado_id = current_apoderado_id());
