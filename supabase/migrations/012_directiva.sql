-- 012_directiva.sql
-- Registro de la directiva del CdP para firmar documentos oficiales (actas,
-- comprobantes). Cada miembro tiene un cargo (presidente, tesorero, etc) y
-- puede o no estar vinculado a un usuario del sistema (profile).
--
-- El acta de recibo de dineros toma el nombre y RUT desde aqui,
-- reemplazando las constantes fijas en lib/config.ts.

-- === ENUM directiva_cargo ===
do $$
begin
  if not exists (select 1 from pg_type where typname = 'directiva_cargo') then
    create type directiva_cargo as enum (
      'presidente',
      'vicepresidente',
      'tesorero',
      'protesorero',
      'secretario',
      'director'
    );
  end if;
end $$;

-- === TABLA directiva_miembros ===
create table if not exists directiva_miembros (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rut text not null,
  cargo directiva_cargo not null,
  activo boolean not null default true,
  orden int not null default 0,
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_directiva_cargo_activo
  on directiva_miembros (cargo, activo);
create index if not exists idx_directiva_orden
  on directiva_miembros (orden, nombre);

-- Solo un miembro activo por cargo (garantiza que haya un tesorero unico,
-- un presidente unico, etc.). Miembros inactivos no cuentan.
create unique index if not exists idx_directiva_cargo_activo_unico
  on directiva_miembros (cargo) where activo = true;

-- === RLS ===
alter table directiva_miembros enable row level security;

drop policy if exists directiva_all_authenticated_select on directiva_miembros;
drop policy if exists directiva_directiva_write on directiva_miembros;

-- Todos los autenticados pueden ver la directiva (para mostrar firmantes,
-- por ejemplo). Solo la directiva puede modificar.
create policy directiva_all_authenticated_select on directiva_miembros
  for select using (auth.uid() is not null);
create policy directiva_directiva_write on directiva_miembros
  for all using (is_directiva()) with check (is_directiva());

-- === SEED: tesorero inicial ===
-- Patricio Caceres Barahona era el tesorero previamente definido en
-- lib/config.ts. Migracion idempotente: no reinserta si ya existe.
insert into directiva_miembros (nombre, rut, cargo, activo, orden)
values ('Patricio Cáceres Barahona', '13.757.066-1', 'tesorero', true, 40)
on conflict do nothing;
