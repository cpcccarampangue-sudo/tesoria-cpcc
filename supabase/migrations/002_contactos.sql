-- =============================================================================
-- Migración 002: separar contactos (padre/madre/tutor) de familias
--
-- La tabla `apoderados` pasa a representar la FAMILIA (unidad de cobro de cuota).
-- Los datos de contacto (nombre, email, telefono) se mueven a una tabla nueva
-- `contactos` con FK al apoderado, permitiendo padre + madre (o más) por familia.
--
-- Corre esta migración UNA VEZ. Es idempotente.
-- =============================================================================

-- Enum de relación (padre, madre, apoderado_cuenta = titular oficial, apoderado_academico, otro)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'contacto_relacion') then
    create type contacto_relacion as enum ('padre', 'madre', 'apoderado_cuenta', 'apoderado_academico', 'otro');
  end if;
  -- Agregar valores nuevos si el enum ya existía con menos valores
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='contacto_relacion' and e.enumlabel='apoderado_cuenta') then
    alter type contacto_relacion add value 'apoderado_cuenta' before 'otro';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='contacto_relacion' and e.enumlabel='apoderado_academico') then
    alter type contacto_relacion add value 'apoderado_academico' before 'otro';
  end if;
end $$;

-- Agregar 'delegado' al enum user_role si aún no está.
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'delegado'
  ) then
    alter type user_role add value 'delegado' before 'apoderado';
  end if;
end $$;

-- Nueva tabla
create table if not exists contactos (
  id uuid primary key default gen_random_uuid(),
  apoderado_id uuid not null references apoderados(id) on delete cascade,
  nombre text not null,
  email text,
  telefono text,
  relacion contacto_relacion not null default 'otro',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_contactos_email_unique
  on contactos (lower(email)) where email is not null;
create index if not exists idx_contactos_apoderado on contactos (apoderado_id);

-- Migrar datos existentes: por cada apoderado con email/telefono/nombre,
-- crear un contacto (si no existe ya).
do $$
declare
  has_email boolean;
  has_tel boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='apoderados' and column_name='email'
  ) into has_email;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='apoderados' and column_name='telefono'
  ) into has_tel;

  if has_email or has_tel then
    execute format($sql$
      insert into contactos (apoderado_id, nombre, email, telefono, relacion)
      select a.id, a.nombre,
             %s,
             %s,
             'otro'::contacto_relacion
      from apoderados a
      where not exists (select 1 from contactos c where c.apoderado_id = a.id)
    $sql$,
      case when has_email then 'a.email' else 'null::text' end,
      case when has_tel then 'a.telefono' else 'null::text' end
    );
  end if;
end $$;

-- Sacar email y telefono de apoderados (ahora en contactos)
alter table apoderados drop column if exists email;
alter table apoderados drop column if exists telefono;
drop index if exists idx_apoderados_email;

-- Actualizar el trigger de auth para buscar en contactos
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_apo_id uuid;
begin
  select c.apoderado_id into v_apo_id
  from contactos c
  where lower(c.email) = lower(new.email) and c.activo
  limit 1;

  insert into profiles (id, email, role, apoderado_id)
  values (new.id, new.email, 'apoderado', v_apo_id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- RLS de contactos
alter table contactos enable row level security;

drop policy if exists contactos_directiva_all on contactos;
drop policy if exists contactos_self_select on contactos;

create policy contactos_directiva_all on contactos
  for all using (is_directiva()) with check (is_directiva());
create policy contactos_self_select on contactos
  for select using (apoderado_id = current_apoderado_id());
