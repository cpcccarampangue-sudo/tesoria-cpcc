-- =============================================================================
-- Migración 005: regalo por incorporación + roles de apoderado en contactos
-- =============================================================================

-- Regalo (una agenda u otra mercadería) por familia socia que se incorpora
alter table cuota_pagos
  add column if not exists regalo_descripcion text,
  add column if not exists regalo_valor_costo numeric(12,0) default 0;

-- Roles de apoderado (cuenta / académico) por contacto
alter table contactos
  add column if not exists es_apoderado_cuenta boolean not null default false,
  add column if not exists es_apoderado_academico boolean not null default false;

-- Índices
create index if not exists idx_contactos_ap_cuenta on contactos (es_apoderado_cuenta) where es_apoderado_cuenta;
create index if not exists idx_contactos_ap_academico on contactos (es_apoderado_academico) where es_apoderado_academico;
