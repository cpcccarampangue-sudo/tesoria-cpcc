-- Modulo convenios: comercios y servicios con beneficios para socios.
--
-- Flujo real: un operador del convenio (comercio) escanea el QR del
-- socio en /validar y recibe lo minimo para aplicar el beneficio.
--
-- Tres tablas:
--
-- 1. convenios: cada comercio con su logo, estado y vigencia.
--
-- 2. convenio_operadores: correos autorizados a validar en nombre de
--    un convenio. Un convenio puede tener varios operadores. Cada
--    operador se autentica con OTP (reutilizando el mecanismo de
--    /incorporacion).
--
-- 3. validaciones_log: auditoria minima de cada validacion. Datos
--    personales minimizados y referencias pseudonimizadas:
--    - convenio_id / convenio_operador_id son FK con ON DELETE RESTRICT
--      (nunca se borran convenios/operadores con historial; se desactivan).
--    - directiva_actor_hmac guarda HMAC-SHA256(AUDIT_HMAC_SECRET, auth.uid())
--      SIN FK, para permitir borrado de auth.users por compliance sin
--      bloquearlo ni romper el log. Reportes recalculan el HMAC server-side.
--    - apoderado_id es FK con ON DELETE SET NULL (si una familia pide
--      borrado total, el log preserva metodo/resultado/created_at).
--    - qr_token_hmac en vez del token QR en claro.
--    - No guarda IP ni apellido buscado.
--    El HMAC usa AUDIT_HMAC_SECRET (env var, >=32 chars).
--
-- Reglas:
--   - La planilla (Google Sheets) es solo origen de importacion.
--     El validador consulta estas tablas internas.
--   - NO eliminar fisicamente registros al desactivar: usar
--     active=false / revoked_at. La FK convenio_operadores -> convenios
--     es ON DELETE RESTRICT justamente para impedir borrados accidentales.
--   - RLS enabled; directiva lee/escribe via policy; service_role
--     bypassa para los flujos publicos autenticados por OTP.

create table if not exists convenios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  logo_url text,
  active boolean not null default true,
  valid_from date,
  valid_until date,
  -- origen de importacion (planilla)
  imported_at timestamptz,
  source_row int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Impide convenios con vigencia invertida. Fechas abiertas (null) son validas.
  constraint convenios_vigencia_coherente check (
    valid_from is null
    or valid_until is null
    or valid_until >= valid_from
  )
);

create index if not exists convenios_active_idx on convenios (active);

create table if not exists convenio_operadores (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT (no CASCADE) para preservar historial: si existen operadores
  -- vinculados, PostgreSQL impide fisicamente el borrado del convenio.
  -- Esto se aplica tambien a service_role: las foreign keys se evaluan
  -- a nivel de motor y no se saltan con bypass de RLS. Para borrar
  -- fisicamente un convenio con referencias, primero hay que resolver
  -- esas referencias (revocar/borrar operadores o migrarlos).
  -- La administracion normal usa soft delete (active=false / revoked_at).
  convenio_id uuid not null references convenios(id) on delete restrict,
  email_normalized text not null,
  active boolean not null default true,
  revoked_at timestamptz,
  imported_at timestamptz,
  source_row int,
  created_at timestamptz not null default now()
);

-- Un mismo email no puede estar duplicado como operador del mismo convenio.
-- Entre convenios SI puede repetirse (una persona que trabaja en varios comercios).
-- Si tras el OTP se encuentran varios convenios activos y vigentes para el
-- mismo correo, el flujo publico muestra un selector al operador y la
-- eleccion se re-valida en servidor contra convenio_operadores.active=true
-- antes de abrir sesion. No se elige automaticamente.
create unique index if not exists convenio_operadores_unico
  on convenio_operadores (convenio_id, email_normalized);
create index if not exists convenio_operadores_email_activo_idx
  on convenio_operadores (email_normalized) where active = true;

create table if not exists validaciones_log (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: no se puede borrar un convenio con validaciones registradas.
  -- Soft delete via convenios.active=false. Coherente con el CHECK que
  -- exige NOT NULL cuando hay convenio_operador_id (SET NULL rompria la
  -- fila al dispararse).
  convenio_id uuid references convenios(id) on delete restrict,
  -- RESTRICT por la misma razon: preservar historial. Operadores se
  -- revocan con active=false / revoked_at, nunca se borran fisicamente.
  convenio_operador_id uuid references convenio_operadores(id) on delete restrict,
  -- Actor directiva pseudonimizado via HMAC-SHA256(AUDIT_HMAC_SECRET, auth.uid()).
  -- SIN foreign key a auth.users: permite que Supabase/compliance borren
  -- la cuenta sin bloquearse ni romper el log. Para reportes "validaciones
  -- del tesorero X", recalcular HMAC(secret, X.id) y filtrar.
  directiva_actor_hmac text,
  metodo text not null check (metodo in ('qr', 'manual', 'apellido')),
  resultado text not null check (resultado in ('vigente', 'no_vigente', 'error')),
  -- HMAC-SHA256(AUDIT_HMAC_SECRET, qr_token) para los metodos qr/manual.
  -- Permite correlacionar validaciones del mismo QR (ej. reuso sospechoso)
  -- sin almacenar un token operativo reutilizable. Null para metodo=apellido.
  qr_token_hmac text,
  -- Si la validacion resolvio una familia conocida. SET NULL si el
  -- apoderado se borra (compliance "right to erasure"): el log preserva
  -- metodo/resultado/created_at pero no expone la identidad ya removida.
  -- Esta columna NO participa en los CHECKs, por lo que SET NULL es seguro.
  apoderado_id uuid references apoderados(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Cada validacion queda atribuida a exactamente un actor: operador de
  -- convenio o directiva (pseudonimizada). Nunca ambos, nunca ninguno.
  -- Un intento sin actor identificado debe rechazarse antes de llegar aqui.
  constraint validaciones_log_actor_coherente check (
    (convenio_operador_id is not null and directiva_actor_hmac is null)
    or
    (convenio_operador_id is null and directiva_actor_hmac is not null)
  ),
  -- Coherencia entre actor y convenio_id:
  --   - operador => convenio_id NOT NULL (el convenio al que pertenece)
  --   - directiva => convenio_id NULL (no actuan en nombre de ningun convenio)
  -- Nota: este CHECK NO puede verificar que convenio_id corresponda al
  -- convenio real del operador (requiere consultar otra tabla). Esa
  -- validacion es OBLIGATORIA en el server-side al escribir el log:
  -- obtener convenio_id del registro convenio_operadores, nunca del cliente.
  constraint validaciones_log_origen_coherente check (
    (
      convenio_operador_id is not null
      and convenio_id is not null
      and directiva_actor_hmac is null
    )
    or
    (
      directiva_actor_hmac is not null
      and convenio_operador_id is null
      and convenio_id is null
    )
  )
);

create index if not exists validaciones_log_created_idx
  on validaciones_log (created_at desc);
create index if not exists validaciones_log_convenio_idx
  on validaciones_log (convenio_id, created_at desc);
-- Indice parcial para auditoria por operador especifico.
create index if not exists validaciones_log_operador_idx
  on validaciones_log (convenio_operador_id, created_at desc)
  where convenio_operador_id is not null;
-- Indice parcial para auditoria por tesorero (directiva pseudonimizada).
create index if not exists validaciones_log_directiva_idx
  on validaciones_log (directiva_actor_hmac, created_at desc)
  where directiva_actor_hmac is not null;

-- Trigger para mantener updated_at al dia en convenios.
create or replace function convenios_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists convenios_updated_at on convenios;
create trigger convenios_updated_at
  before update on convenios
  for each row execute function convenios_set_updated_at();

-- RLS: directiva via policy; nadie mas via grants.
alter table convenios enable row level security;
alter table convenio_operadores enable row level security;
alter table validaciones_log enable row level security;

drop policy if exists convenios_directiva_all on convenios;
drop policy if exists convenio_operadores_directiva_all on convenio_operadores;
drop policy if exists validaciones_log_directiva_select on validaciones_log;

create policy convenios_directiva_all on convenios
  for all using (is_directiva()) with check (is_directiva());
create policy convenio_operadores_directiva_all on convenio_operadores
  for all using (is_directiva()) with check (is_directiva());
create policy validaciones_log_directiva_select on validaciones_log
  for select using (is_directiva());

-- Nadie salvo directiva puede tocar directamente. Los flujos publicos
-- (login operador, auditoria de validacion) usan service_role desde
-- server actions.
revoke all on convenios from anon, authenticated;
revoke all on convenio_operadores from anon, authenticated;
revoke all on validaciones_log from anon, authenticated;

-- Sin DELETE: la administracion normal usa soft delete (active=false /
-- revoked_at). Si en el futuro se necesita borrar fisicamente algo,
-- debe hacerse desde service_role como accion explicita.
grant select, insert, update on convenios to authenticated;
grant select, insert, update on convenio_operadores to authenticated;
grant select on validaciones_log to authenticated;
