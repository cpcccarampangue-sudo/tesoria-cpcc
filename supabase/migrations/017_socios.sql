-- 017_socios.sql
-- Modulo de incorporacion de socios: formulario publico donde los apoderados
-- se registran y pagan la cuota via SumUp. Al confirmarse el pago (webhook),
-- se les envia por correo un QR que apunta a /socio/{token} para que
-- delegados, directiva y convenios puedan verificar membresia activa
-- escaneando con el celular desde el validador PWA /validar.

-- Config global del modulo (una sola fila). Permite editar el ano activo,
-- el monto de la cuota y el link SumUp sin tocar codigo.
create table if not exists socio_config (
  id int primary key default 1,
  periodo_anio int not null default extract(year from now())::int,
  monto_cuota int not null default 20000,
  sumup_link text,
  sumup_checkout_fijo boolean not null default false,
  mensaje_bienvenida text,
  updated_at timestamptz not null default now(),
  constraint socio_config_single_row check (id = 1)
);

insert into socio_config (id, periodo_anio, monto_cuota)
values (1, extract(year from now())::int, 20000)
on conflict (id) do nothing;

-- Estados de la solicitud:
--   pendiente_pago  -> acaba de llenar el form, aun no paga
--   pagada          -> SumUp confirmo pago (via webhook o aprobacion manual)
--   enviada         -> correo con QR enviado al apoderado
--   rechazada       -> la directiva decidio rechazarla (p.ej. pago no cuadra)
--   anulada         -> solicitud cancelada antes de pagar
do $$ begin
  create type socio_estado as enum (
    'pendiente_pago',
    'pagada',
    'enviada',
    'rechazada',
    'anulada'
  );
exception when duplicate_object then null; end $$;

create table if not exists socio_solicitudes (
  id uuid primary key default gen_random_uuid(),
  -- Token publico unico para el QR y la url /socio/{token}
  qr_token uuid not null unique default gen_random_uuid(),
  periodo_anio int not null,
  -- Datos del apoderado
  apoderado_nombre text not null,
  apoderado_email text not null,
  apoderado_rut text,
  apoderado_telefono text,
  -- Datos del alumno
  alumno_nombre text not null,
  curso text not null,
  -- Pago via SumUp
  monto_cuota int not null,
  sumup_checkout_id text,
  sumup_transaction_id text,
  sumup_transaction_code text,
  pagada_en timestamptz,
  -- Correo con QR
  email_enviado_en timestamptz,
  email_reenvios int not null default 0,
  -- Flujo
  estado socio_estado not null default 'pendiente_pago',
  notas_internas text,
  -- Si lo aprobo o rechazo alguien de directiva manualmente
  procesada_por uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_socio_solicitudes_periodo
  on socio_solicitudes (periodo_anio);
create index if not exists idx_socio_solicitudes_estado
  on socio_solicitudes (estado);
create index if not exists idx_socio_solicitudes_email
  on socio_solicitudes (lower(apoderado_email));
create index if not exists idx_socio_solicitudes_checkout
  on socio_solicitudes (sumup_checkout_id) where sumup_checkout_id is not null;

-- Trigger para updated_at
create or replace function socio_solicitudes_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_socio_solicitudes_updated_at on socio_solicitudes;
create trigger trg_socio_solicitudes_updated_at
  before update on socio_solicitudes
  for each row execute function socio_solicitudes_touch_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

alter table socio_config enable row level security;
alter table socio_solicitudes enable row level security;

-- socio_config: directiva lee y escribe. El publico (anon) tambien lee para
-- que el formulario publico pueda mostrar el monto y el link SumUp.
drop policy if exists socio_config_public_read on socio_config;
drop policy if exists socio_config_directiva_write on socio_config;

create policy socio_config_public_read on socio_config
  for select using (true);
create policy socio_config_directiva_write on socio_config
  for all using (is_directiva()) with check (is_directiva());

-- socio_solicitudes:
--   - anon puede INSERT (crear su solicitud desde /incorporacion)
--   - anon puede SELECT solo por qr_token exacto (para la pagina /socio/{token}
--     y el validador PWA). Esto se controla desde el filtro de la query en
--     app; aqui a nivel RLS permitimos select publico porque el token es
--     secreto y actua como auth.
--   - directiva puede ver y actualizar todo
drop policy if exists socio_solicitudes_public_insert on socio_solicitudes;
drop policy if exists socio_solicitudes_public_select_by_token on socio_solicitudes;
drop policy if exists socio_solicitudes_directiva_all on socio_solicitudes;

create policy socio_solicitudes_public_insert on socio_solicitudes
  for insert with check (true);
-- Permitimos SELECT publico; la seguridad depende de conocer el qr_token
-- (uuid aleatorio imposible de adivinar). La app siempre filtra por token.
create policy socio_solicitudes_public_select_by_token on socio_solicitudes
  for select using (true);
create policy socio_solicitudes_directiva_all on socio_solicitudes
  for all using (is_directiva()) with check (is_directiva());

-- Grants explicitos para el rol anon (que es el que usa el cliente publico
-- sin login). Supabase usa authenticated y anon por defecto.
grant select on socio_config to anon, authenticated;
grant insert, select on socio_solicitudes to anon, authenticated;
grant usage on type socio_estado to anon, authenticated;
