-- 016_cargo_permisos.sql
-- Matriz de permisos por cargo de directiva sobre los distintos modulos de
-- la app. Cada cargo tiene un nivel por modulo:
--   - 'ninguno'   -> no aparece en el menu, redirige si entra por URL
--   - 'lectura'   -> ve el modulo pero no puede crear/editar/eliminar
--   - 'escritura' -> acceso total
-- Si un usuario con rol 'directiva' no esta linkeado a ningun cargo activo,
-- se le trata como escritura en todo (compat con instalaciones existentes).

do $$ begin
  create type permiso_nivel as enum ('ninguno', 'lectura', 'escritura');
exception when duplicate_object then null; end $$;

create table if not exists cargo_permisos (
  cargo directiva_cargo not null,
  modulo text not null,
  nivel permiso_nivel not null default 'ninguno',
  updated_at timestamptz not null default now(),
  primary key (cargo, modulo)
);

alter table cargo_permisos enable row level security;

drop policy if exists cargo_permisos_directiva_select on cargo_permisos;
drop policy if exists cargo_permisos_directiva_write on cargo_permisos;

create policy cargo_permisos_directiva_select on cargo_permisos
  for select using (is_directiva());
create policy cargo_permisos_directiva_write on cargo_permisos
  for all using (is_directiva()) with check (is_directiva());

-- Seed de defaults: tesorero puede todo; resto de cargos tiene lectura en
-- lo financiero + escritura en Actas/Certificados (su herramienta de
-- trabajo mas comun) + lectura en Directiva/Usuarios para visibilidad.
-- Si la fila ya existia (migracion previa), se respeta el valor actual.

insert into cargo_permisos (cargo, modulo, nivel) values
  -- Tesorero: escritura total
  ('tesorero', 'movimientos', 'escritura'),
  ('tesorero', 'cuentas', 'escritura'),
  ('tesorero', 'cartolas', 'escritura'),
  ('tesorero', 'cuotas', 'escritura'),
  ('tesorero', 'eventos', 'escritura'),
  ('tesorero', 'familias', 'escritura'),
  ('tesorero', 'actas', 'escritura'),
  ('tesorero', 'certificados', 'escritura'),
  ('tesorero', 'categorias', 'escritura'),
  ('tesorero', 'reportes', 'escritura'),
  ('tesorero', 'directiva', 'escritura'),
  ('tesorero', 'usuarios', 'escritura'),

  -- Protesorero: igual que tesorero (es su backup)
  ('protesorero', 'movimientos', 'escritura'),
  ('protesorero', 'cuentas', 'escritura'),
  ('protesorero', 'cartolas', 'escritura'),
  ('protesorero', 'cuotas', 'escritura'),
  ('protesorero', 'eventos', 'escritura'),
  ('protesorero', 'familias', 'escritura'),
  ('protesorero', 'actas', 'escritura'),
  ('protesorero', 'certificados', 'escritura'),
  ('protesorero', 'categorias', 'escritura'),
  ('protesorero', 'reportes', 'escritura'),
  ('protesorero', 'directiva', 'lectura'),
  ('protesorero', 'usuarios', 'lectura'),

  -- Presidente: lectura financiera + escritura en actas/certificados/directiva
  ('presidente', 'movimientos', 'lectura'),
  ('presidente', 'cuentas', 'lectura'),
  ('presidente', 'cartolas', 'lectura'),
  ('presidente', 'cuotas', 'lectura'),
  ('presidente', 'eventos', 'escritura'),
  ('presidente', 'familias', 'lectura'),
  ('presidente', 'actas', 'escritura'),
  ('presidente', 'certificados', 'escritura'),
  ('presidente', 'categorias', 'lectura'),
  ('presidente', 'reportes', 'lectura'),
  ('presidente', 'directiva', 'escritura'),
  ('presidente', 'usuarios', 'lectura'),

  -- Vicepresidente: igual que presidente
  ('vicepresidente', 'movimientos', 'lectura'),
  ('vicepresidente', 'cuentas', 'lectura'),
  ('vicepresidente', 'cartolas', 'lectura'),
  ('vicepresidente', 'cuotas', 'lectura'),
  ('vicepresidente', 'eventos', 'escritura'),
  ('vicepresidente', 'familias', 'lectura'),
  ('vicepresidente', 'actas', 'escritura'),
  ('vicepresidente', 'certificados', 'escritura'),
  ('vicepresidente', 'categorias', 'lectura'),
  ('vicepresidente', 'reportes', 'lectura'),
  ('vicepresidente', 'directiva', 'lectura'),
  ('vicepresidente', 'usuarios', 'lectura'),

  -- Secretario: escritura en actas/certificados/directiva, lectura en lo demas
  ('secretario', 'movimientos', 'lectura'),
  ('secretario', 'cuentas', 'lectura'),
  ('secretario', 'cartolas', 'lectura'),
  ('secretario', 'cuotas', 'lectura'),
  ('secretario', 'eventos', 'escritura'),
  ('secretario', 'familias', 'escritura'),
  ('secretario', 'actas', 'escritura'),
  ('secretario', 'certificados', 'escritura'),
  ('secretario', 'categorias', 'lectura'),
  ('secretario', 'reportes', 'lectura'),
  ('secretario', 'directiva', 'escritura'),
  ('secretario', 'usuarios', 'lectura'),

  -- Director: lectura en todo + escritura en actas/certificados
  ('director', 'movimientos', 'lectura'),
  ('director', 'cuentas', 'lectura'),
  ('director', 'cartolas', 'lectura'),
  ('director', 'cuotas', 'lectura'),
  ('director', 'eventos', 'lectura'),
  ('director', 'familias', 'lectura'),
  ('director', 'actas', 'escritura'),
  ('director', 'certificados', 'escritura'),
  ('director', 'categorias', 'lectura'),
  ('director', 'reportes', 'lectura'),
  ('director', 'directiva', 'lectura'),
  ('director', 'usuarios', 'lectura')
on conflict (cargo, modulo) do nothing;
