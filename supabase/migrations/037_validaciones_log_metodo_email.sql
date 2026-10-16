-- =============================================================================
-- Migración 037: ampliar el CHECK de validaciones_log.metodo para incluir 'email'
--
-- Motivacion: el validador suma una alternativa de confirmacion por correo
-- electronico (ademas de "ultimos 4 digitos del telefono"). Para distinguir
-- en auditoria entre ambas rutas registramos:
--   - metodo='apellido' cuando se busca por apellido y se confirma con PIN
--     telefonico (comportamiento historico).
--   - metodo='email'    cuando se busca por apellido y se confirma con el
--     correo registrado (nuevo).
--
-- Es puramente aditiva: no toca registros existentes (todos cumplen con los
-- valores ya aceptados). Es idempotente: si la constraint ya tiene 'email',
-- la operacion queda como no-op porque dropeamos+recreamos siempre.
--
-- Rollback: volver a crear la constraint sin 'email' tras eliminar o
-- migrar los registros con metodo='email' (si los hubiera).
-- =============================================================================

alter table validaciones_log
  drop constraint if exists validaciones_log_metodo_check;

alter table validaciones_log
  add constraint validaciones_log_metodo_check
  check (metodo in ('qr', 'manual', 'apellido', 'email'));
