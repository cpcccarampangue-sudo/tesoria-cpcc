-- =============================================================================
-- Migración 004: rol delegado con curso asignado
-- =============================================================================

-- Asegurar que 'delegado' está en el enum user_role
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'delegado'
  ) then
    alter type user_role add value 'delegado' before 'apoderado';
  end if;
end $$;

-- Columna nueva: curso asignado (solo relevante para delegados)
alter table profiles
  add column if not exists curso_asignado text;

-- Helper: rol delegado
create or replace function is_delegado()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'delegado'
  );
$$;

grant execute on function is_delegado() to authenticated;

-- Helper: curso asignado del delegado actual
create or replace function current_curso_asignado()
returns text
language sql stable security definer set search_path = public as $$
  select curso_asignado from profiles where id = auth.uid();
$$;

grant execute on function current_curso_asignado() to authenticated;

-- =============================================================================
-- Políticas RLS para delegado (SELECT only en las tablas relevantes)
-- =============================================================================

-- apoderados: delegado ve familias que tengan al menos un estudiante en su curso
drop policy if exists apoderados_delegado_select on apoderados;
create policy apoderados_delegado_select on apoderados
  for select using (
    is_delegado()
    and current_curso_asignado() is not null
    and exists (
      select 1 from estudiantes e
      where e.apoderado_id = apoderados.id
        and e.curso = current_curso_asignado()
        and e.activo
    )
  );

-- estudiantes: delegado ve estudiantes de su curso
drop policy if exists estudiantes_delegado_select on estudiantes;
create policy estudiantes_delegado_select on estudiantes
  for select using (
    is_delegado()
    and current_curso_asignado() is not null
    and curso = current_curso_asignado()
  );

-- contactos: delegado ve contactos de familias que puede ver
drop policy if exists contactos_delegado_select on contactos;
create policy contactos_delegado_select on contactos
  for select using (
    is_delegado()
    and current_curso_asignado() is not null
    and exists (
      select 1 from estudiantes e
      where e.apoderado_id = contactos.apoderado_id
        and e.curso = current_curso_asignado()
        and e.activo
    )
  );

-- cuota_pagos: delegado ve pagos de familias que puede ver
drop policy if exists cuota_pagos_delegado_select on cuota_pagos;
create policy cuota_pagos_delegado_select on cuota_pagos
  for select using (
    is_delegado()
    and current_curso_asignado() is not null
    and exists (
      select 1 from estudiantes e
      where e.apoderado_id = cuota_pagos.apoderado_id
        and e.curso = current_curso_asignado()
        and e.activo
    )
  );
