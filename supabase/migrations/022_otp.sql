-- OTP de verificacion de correo para /incorporacion.
--
-- Dos tablas:
--
-- 1. otp_codigos: cada codigo emitido (6 digitos, 10 min de vigencia,
--    maximo 5 intentos). Guardamos SHA-256(pepper + email + codigo),
--    nunca el codigo en texto plano. Cuando se emite uno nuevo para un
--    mismo correo, los anteriores (vigentes) se invalidan.
--
-- 2. otp_sesiones: una vez verificado el OTP, se crea una sesion de 30
--    min. El id uuid v4 se guarda en una cookie HttpOnly Secure
--    SameSite=Lax. Al "consumir" la sesion (crear solicitud, generar
--    pago) marcamos used_at para no reutilizar.
--
-- Ambas tablas:
--   - NO tienen policies para anon (RLS enabled sin policies -> acceso denegado).
--   - Solo el server (via service_role) las toca.

create extension if not exists pgcrypto;

create table if not exists otp_codigos (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  codigo_hash text not null,
  intentos int not null default 0,
  usado_en timestamptz,
  invalidado_en timestamptz,
  expires_at timestamptz not null,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists otp_codigos_email_idx
  on otp_codigos (email, created_at desc);
create index if not exists otp_codigos_expires_idx
  on otp_codigos (expires_at);

create table if not exists otp_sesiones (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists otp_sesiones_email_idx on otp_sesiones (email);
create index if not exists otp_sesiones_expires_idx on otp_sesiones (expires_at);

-- RLS encendido pero SIN policies. Esto bloquea TODO acceso excepto
-- service_role (que bypassa RLS). Es a proposito: las tablas solo
-- deben tocarse desde server actions con el admin client.
alter table otp_codigos enable row level security;
alter table otp_sesiones enable row level security;

-- No damos grants a anon ni authenticated. Para que quede explicito:
revoke all on otp_codigos from anon, authenticated;
revoke all on otp_sesiones from anon, authenticated;
