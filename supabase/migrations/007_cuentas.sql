-- 007_cuentas.sql
-- Multi-cuenta: representar en el sistema las 3 "ubicaciones" reales de la plata
-- del CdP: la cuenta vista Banco Estado a nombre del CdP (principal), la
-- Cuenta FAN Banco Chile a nombre del tesorero (operativa) y la caja chica.
-- A partir de esta migracion, cada movimiento pertenece a una cuenta.

-- === TABLA cuentas ===
create table if not exists cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text not null check (tipo in ('banco', 'efectivo', 'otro')),
  banco text,
  titular text,
  numero_cuenta text,
  color text,
  orden int not null default 0,
  activa boolean not null default true,
  es_principal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_cuentas_orden on cuentas (orden, nombre);

-- Solo una cuenta puede tener es_principal = true (usada como default en formularios).
create unique index if not exists idx_cuentas_principal_unica
  on cuentas (es_principal) where es_principal = true;

-- === SEED: 3 cuentas iniciales del CdP ===
insert into cuentas (nombre, tipo, banco, titular, orden, es_principal, color)
values
  ('Banco Estado — CdP',       'banco',    'banco_estado', 'Centro de Padres',            1, true,  '#f97316'),
  ('Banco Chile — Cuenta FAN', 'banco',    'banco_chile',  'Tesorero (a nombre del CdP)', 2, false, '#1e40af'),
  ('Caja Chica',               'efectivo', null,           null,                          3, false, '#65a30d')
on conflict (nombre) do nothing;

-- === COLUMNA cuenta_id EN movimientos ===
alter table movimientos add column if not exists cuenta_id uuid references cuentas(id);

-- Backfill: todos los movimientos historicos van a la cuenta principal.
update movimientos
set cuenta_id = (select id from cuentas where es_principal = true limit 1)
where cuenta_id is null;

-- Set NOT NULL una vez backfilleado.
alter table movimientos alter column cuenta_id set not null;

create index if not exists idx_movimientos_cuenta on movimientos (cuenta_id);

-- === RLS de cuentas ===
alter table cuentas enable row level security;

drop policy if exists cuentas_all_authenticated_select on cuentas;
drop policy if exists cuentas_directiva_write on cuentas;

-- Todos los autenticados pueden ver las cuentas (necesario para dashboard/labels).
-- Solo la directiva puede crear/modificar.
create policy cuentas_all_authenticated_select on cuentas
  for select using (auth.uid() is not null);
create policy cuentas_directiva_write on cuentas
  for all using (is_directiva()) with check (is_directiva());

-- === VISTA v_balance_por_cuenta ===
-- Saldo por cuenta = ingresos - egresos, dentro de la misma cuenta.
create or replace view v_balance_por_cuenta as
select
  c.id,
  c.nombre,
  c.tipo,
  c.banco,
  c.titular,
  c.color,
  c.orden,
  c.activa,
  c.es_principal,
  coalesce(sum(m.monto) filter (where m.tipo = 'ingreso'), 0)::numeric as ingresos,
  coalesce(sum(m.monto) filter (where m.tipo = 'egreso'),  0)::numeric as egresos,
  (coalesce(sum(m.monto) filter (where m.tipo = 'ingreso'), 0)
   - coalesce(sum(m.monto) filter (where m.tipo = 'egreso'),  0))::numeric as saldo,
  count(m.id)::int as movimientos_count
from cuentas c
left join movimientos m on m.cuenta_id = c.id
group by c.id;

-- === FUNCION api_balance_por_cuenta (security definer para apoderados) ===
-- Los apoderados no pueden leer movimientos, pero si el saldo agregado por cuenta.
create or replace function api_balance_por_cuenta()
returns setof v_balance_por_cuenta
language sql stable security definer set search_path = public as $$
  select * from v_balance_por_cuenta where activa order by orden, nombre;
$$;
grant execute on function api_balance_por_cuenta() to authenticated;
