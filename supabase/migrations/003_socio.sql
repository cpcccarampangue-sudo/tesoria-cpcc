-- =============================================================================
-- Migración 003: distinguir socios de no socios del Centro de Padres
--
-- Agrega columna `socio` (boolean) en apoderados. Los no socios se mantienen
-- registrados en el sistema pero pueden tratarse distinto (ej. no cobrarles
-- cuota, o cobrarles otro monto).
-- =============================================================================

alter table apoderados
  add column if not exists socio boolean not null default true;

create index if not exists idx_apoderados_socio on apoderados (socio);
