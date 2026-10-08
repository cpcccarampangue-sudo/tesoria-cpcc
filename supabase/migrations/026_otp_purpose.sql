-- 026_otp_purpose.sql
--
-- Agrega "purpose" a los OTP para que un codigo emitido para un flujo
-- NO pueda validarse en otro. Hoy el pepper + email + codigo son los
-- unicos componentes del hash; agregando purpose:
--   - el hash incluye purpose (verificado en server),
--   - las queries de busqueda filtran por purpose,
--   - las sesiones quedan atadas al purpose que las creo.
--
-- Backfill: todos los codigos y sesiones previos quedan como
-- 'incorporacion' (el unico purpose que existia hasta ahora).
--
-- Despues de aplicar esta migracion, el codigo debe emitir siempre con
-- purpose explicito. No hay default a nivel DB (NOT NULL + CHECK).

-- Variante EXPAND (compatible con codigo viejo): la columna se agrega
-- con default 'incorporacion' para que inserts del codigo viejo (sin
-- pasar purpose) sigan funcionando mientras se despliega el nuevo. En
-- PG 11+ el ADD COLUMN con default se aplica virtualmente, sin reescribir
-- la tabla. El UPDATE siguiente es defensivo (no-op despues del ADD).
-- Una migracion 027 futura hara DROP DEFAULT despues de confirmar
-- estabilidad del codigo nuevo (que siempre pasa purpose explicito).

alter table otp_codigos
  add column if not exists purpose text default 'incorporacion';
alter table otp_sesiones
  add column if not exists purpose text default 'incorporacion';

update otp_codigos set purpose = 'incorporacion' where purpose is null;
update otp_sesiones set purpose = 'incorporacion' where purpose is null;

alter table otp_codigos alter column purpose set not null;
alter table otp_sesiones alter column purpose set not null;

alter table otp_codigos
  drop constraint if exists otp_codigos_purpose_check;
alter table otp_codigos
  add constraint otp_codigos_purpose_check
  check (purpose in ('incorporacion', 'operador'));

alter table otp_sesiones
  drop constraint if exists otp_sesiones_purpose_check;
alter table otp_sesiones
  add constraint otp_sesiones_purpose_check
  check (purpose in ('incorporacion', 'operador'));

create index if not exists otp_codigos_email_purpose_idx
  on otp_codigos (email, purpose, created_at desc);
create index if not exists otp_sesiones_email_purpose_idx
  on otp_sesiones (email, purpose);
