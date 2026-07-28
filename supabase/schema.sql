-- =============================================================================
-- Tesorería CPCC — Schema completo (Supabase / Postgres)
-- Copiar y pegar este archivo entero en el SQL Editor de Supabase y ejecutar.
-- Es idempotente: se puede volver a correr sin romper datos existentes.
-- =============================================================================

-- === ENUMS ===
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('directiva', 'apoderado');
  end if;
  if not exists (select 1 from pg_type where typname = 'mov_tipo') then
    create type mov_tipo as enum ('ingreso', 'egreso');
  end if;
  if not exists (select 1 from pg_type where typname = 'cuota_estado') then
    create type cuota_estado as enum ('pendiente', 'pagada', 'parcial', 'exenta');
  end if;
end $$;

-- === APODERADOS (creado antes de profiles porque profiles tiene FK a él) ===
create table if not exists apoderados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text unique,
  telefono text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_apoderados_email on apoderados (lower(email));

-- === ESTUDIANTES (hijos del apoderado; una familia puede tener varios) ===
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

-- === PROFILES (1:1 con auth.users) ===
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nombre text,
  role user_role not null default 'apoderado',
  apoderado_id uuid references apoderados(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_profiles_role on profiles (role);
create index if not exists idx_profiles_apoderado on profiles (apoderado_id);

-- === CATEGORÍAS ===
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo mov_tipo not null,
  activa boolean not null default true
);

-- === EVENTOS ===
create table if not exists eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  fecha date,
  cerrado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_eventos_fecha on eventos (fecha desc);

-- === CUOTAS ===
create table if not exists cuota_periodos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  monto numeric(12,0) not null check (monto >= 0),
  fecha_vencimiento date,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cuota_pagos (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references cuota_periodos(id) on delete cascade,
  apoderado_id uuid not null references apoderados(id) on delete cascade,
  monto_pagado numeric(12,0) not null default 0 check (monto_pagado >= 0),
  estado cuota_estado not null default 'pendiente',
  fecha_pago date,
  nota text,
  unique (periodo_id, apoderado_id)
);
create index if not exists idx_cuota_pagos_apoderado on cuota_pagos (apoderado_id);
create index if not exists idx_cuota_pagos_periodo on cuota_pagos (periodo_id);

-- === MOVIMIENTOS ===
create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo mov_tipo not null,
  monto numeric(12,0) not null check (monto > 0),
  descripcion text,
  categoria_id uuid references categorias(id) on delete set null,
  evento_id uuid references eventos(id) on delete set null,
  cuota_pago_id uuid references cuota_pagos(id) on delete set null,
  boleta_path text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_movimientos_fecha on movimientos (fecha desc);
create index if not exists idx_movimientos_evento on movimientos (evento_id);
create index if not exists idx_movimientos_categoria on movimientos (categoria_id);
create index if not exists idx_movimientos_cuota on movimientos (cuota_pago_id);

-- =============================================================================
-- VISTAS de agregación (usadas por la UI para KPIs)
-- =============================================================================

create or replace view v_balance_general as
select
  coalesce(sum(monto) filter (where tipo='ingreso'), 0)::numeric as total_ingresos,
  coalesce(sum(monto) filter (where tipo='egreso'),  0)::numeric as total_egresos,
  (coalesce(sum(monto) filter (where tipo='ingreso'), 0)
   - coalesce(sum(monto) filter (where tipo='egreso'),  0))::numeric as saldo
from movimientos;

create or replace view v_balance_por_evento as
select
  e.id,
  e.nombre,
  e.fecha,
  e.cerrado,
  coalesce(sum(m.monto) filter (where m.tipo='ingreso'), 0)::numeric as ingresos,
  coalesce(sum(m.monto) filter (where m.tipo='egreso'),  0)::numeric as egresos,
  (coalesce(sum(m.monto) filter (where m.tipo='ingreso'), 0)
   - coalesce(sum(m.monto) filter (where m.tipo='egreso'),  0))::numeric as neto
from eventos e
left join movimientos m on m.evento_id = e.id
group by e.id, e.nombre, e.fecha, e.cerrado;

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

-- =============================================================================
-- FUNCIONES DE APOYO (security definer)
-- =============================================================================

create or replace function is_directiva()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'directiva'
  );
$$;

create or replace function current_apoderado_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select apoderado_id from profiles where id = auth.uid();
$$;

grant execute on function is_directiva() to authenticated;
grant execute on function current_apoderado_id() to authenticated;

-- Funciones para que apoderados accedan a agregados sin ver filas de movimientos.

create or replace function api_balance_general()
returns table(total_ingresos numeric, total_egresos numeric, saldo numeric)
language sql stable security definer set search_path = public as $$
  select total_ingresos, total_egresos, saldo from v_balance_general;
$$;
grant execute on function api_balance_general() to authenticated;

create or replace function api_balance_por_evento()
returns setof v_balance_por_evento
language sql stable security definer set search_path = public as $$
  select * from v_balance_por_evento order by fecha desc nulls last, nombre;
$$;
grant execute on function api_balance_por_evento() to authenticated;

-- Trigger que crea el profile automáticamente al registrarse un usuario
-- y lo enlaza con el apoderado existente por email (si coincide).

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_apo_id uuid;
begin
  select id into v_apo_id from apoderados where lower(email) = lower(new.email);
  insert into profiles (id, email, role, apoderado_id)
  values (new.id, new.email, 'apoderado', v_apo_id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table profiles       enable row level security;
alter table apoderados     enable row level security;
alter table estudiantes    enable row level security;
alter table categorias     enable row level security;
alter table eventos        enable row level security;
alter table cuota_periodos enable row level security;
alter table cuota_pagos    enable row level security;
alter table movimientos    enable row level security;

-- Drop policies existentes para poder re-ejecutar el script.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','apoderados','estudiantes','categorias','eventos',
                        'cuota_periodos','cuota_pagos','movimientos')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- === profiles ===
create policy profiles_self_or_directiva_select on profiles
  for select using (id = auth.uid() or is_directiva());
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_directiva_all on profiles
  for all using (is_directiva()) with check (is_directiva());

-- === apoderados ===
create policy apoderados_directiva_all on apoderados
  for all using (is_directiva()) with check (is_directiva());
create policy apoderados_self_select on apoderados
  for select using (id = current_apoderado_id());

-- === estudiantes ===
create policy estudiantes_directiva_all on estudiantes
  for all using (is_directiva()) with check (is_directiva());
create policy estudiantes_self_select on estudiantes
  for select using (apoderado_id = current_apoderado_id());

-- === categorias ===
create policy categorias_all_authenticated_select on categorias
  for select using (auth.uid() is not null);
create policy categorias_directiva_write on categorias
  for all using (is_directiva()) with check (is_directiva());

-- === eventos ===
create policy eventos_all_authenticated_select on eventos
  for select using (auth.uid() is not null);
create policy eventos_directiva_write on eventos
  for all using (is_directiva()) with check (is_directiva());

-- === cuota_periodos ===
create policy periodos_activos_select on cuota_periodos
  for select using (activa = true or is_directiva());
create policy periodos_directiva_write on cuota_periodos
  for all using (is_directiva()) with check (is_directiva());

-- === cuota_pagos ===
create policy pagos_self_select on cuota_pagos
  for select using (apoderado_id = current_apoderado_id());
create policy pagos_directiva_all on cuota_pagos
  for all using (is_directiva()) with check (is_directiva());

-- === movimientos ===
-- Solo directiva ve/edita movimientos. Apoderados usan las funciones api_*.
create policy movimientos_directiva_all on movimientos
  for all using (is_directiva()) with check (is_directiva());

-- =============================================================================
-- STORAGE: bucket 'boletas' (crear en Storage UI si no existe, o vía SQL)
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('boletas', 'boletas', false)
on conflict (id) do nothing;

drop policy if exists boletas_directiva_select on storage.objects;
drop policy if exists boletas_directiva_insert on storage.objects;
drop policy if exists boletas_directiva_delete on storage.objects;

create policy boletas_directiva_select on storage.objects
  for select using (bucket_id = 'boletas' and is_directiva());
create policy boletas_directiva_insert on storage.objects
  for insert with check (bucket_id = 'boletas' and is_directiva());
create policy boletas_directiva_delete on storage.objects
  for delete using (bucket_id = 'boletas' and is_directiva());

-- =============================================================================
-- SEED: categorías iniciales (opcional, útil para arrancar)
-- =============================================================================

insert into categorias (nombre, tipo, activa) values
  ('Cuota apoderado', 'ingreso', true),
  ('Donación', 'ingreso', true),
  ('Evento - rifas', 'ingreso', true),
  ('Evento - venta', 'ingreso', true),
  ('Aporte colegio', 'ingreso', true),
  ('Otro ingreso', 'ingreso', true),
  ('Materiales', 'egreso', true),
  ('Premios / regalos', 'egreso', true),
  ('Alimentación / colación', 'egreso', true),
  ('Impresión / papelería', 'egreso', true),
  ('Transporte', 'egreso', true),
  ('Servicios', 'egreso', true),
  ('Otro egreso', 'egreso', true)
on conflict (nombre) do nothing;

-- =============================================================================
-- FIN
-- Recuerda: después de que la primera persona de directiva ingrese al sistema
-- por primera vez (creando su fila en auth.users), correr:
--
--   update profiles set role = 'directiva' where email = 'tesorera@colegio.cl';
--
-- =============================================================================
