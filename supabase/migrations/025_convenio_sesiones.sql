-- 025_convenio_sesiones.sql
--
-- Sesiones de operadores de convenio en /validar.
--
-- El token real (uuid random de 32 bytes) vive SOLO en la cookie
-- conv_session (HttpOnly / Secure / SameSite=Lax). En la base guardamos
-- SHA-256 del token (session_hash). Al verificar, hasheamos la cookie
-- entrante y buscamos; si se filtra la DB, no se pueden secuestrar
-- sesiones vigentes.
--
-- TTL absoluto de 24h (no renovable con uso). last_used_at es solo
-- auditoria; no extiende expires_at.
--
-- La sesion queda vinculada al operador Y al convenio seleccionado.
-- Si el convenio o el operador se desactivan durante las 24h, la
-- sesion deja de ser valida (chequeo en cada request contra
-- convenio_operadores.active y convenios.active).

create table if not exists convenio_sesiones (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null,
  convenio_id uuid not null references convenios(id) on delete restrict,
  convenio_operador_id uuid not null references convenio_operadores(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint convenio_sesiones_expires_coherente check (expires_at > created_at)
);

create unique index if not exists convenio_sesiones_hash_idx
  on convenio_sesiones (session_hash);
create index if not exists convenio_sesiones_operador_idx
  on convenio_sesiones (convenio_operador_id, created_at desc);
create index if not exists convenio_sesiones_expires_idx
  on convenio_sesiones (expires_at);

alter table convenio_sesiones enable row level security;

revoke all on convenio_sesiones from anon, authenticated;

-- Trigger de integridad: en INSERT/UPDATE de las FKs, verifica que el
-- convenio_id realmente pertenezca al convenio_operador. La restriccion
-- no se puede expresar como CHECK (requeriria subquery), por eso vamos
-- por trigger. El unico callsite real es crearSesionOperador via
-- service_role; el trigger es defensa en profundidad contra inserts
-- maliciosos o bugs futuros.
create or replace function convenio_sesiones_validar_coherencia()
returns trigger
language plpgsql
as $$
declare
  v_convenio_del_operador uuid;
begin
  select convenio_id into v_convenio_del_operador
    from convenio_operadores
   where id = new.convenio_operador_id;
  if v_convenio_del_operador is null then
    raise exception 'convenio_operador % no existe', new.convenio_operador_id
      using errcode = '23503';
  end if;
  if v_convenio_del_operador <> new.convenio_id then
    raise exception 'convenio_id % no corresponde al operador % (su convenio real es %)',
      new.convenio_id, new.convenio_operador_id, v_convenio_del_operador
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists convenio_sesiones_coherencia on convenio_sesiones;
create trigger convenio_sesiones_coherencia
  before insert or update of convenio_id, convenio_operador_id on convenio_sesiones
  for each row execute function convenio_sesiones_validar_coherencia();
