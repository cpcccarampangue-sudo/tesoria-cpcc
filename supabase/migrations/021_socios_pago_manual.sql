-- 021_socios_pago_manual.sql
-- Integra el modulo de socios con el libro de caja (movimientos):
--   - Linkea cada solicitud al movimiento ingreso que genera el pago.
--   - Agrega categoria "Cuota socio CdP" si no existe (para que el movimiento
--     auto-creado tenga categorizacion correcta en reportes).
--   - Agrega a socio_config una cuenta por defecto para pagos SumUp
--     (webhook automatico necesita saber a que cuenta ingresan los pagos).

alter table socio_solicitudes
  add column if not exists movimiento_id uuid references movimientos(id) on delete set null;

create index if not exists idx_socio_solicitudes_movimiento
  on socio_solicitudes (movimiento_id);

alter table socio_config
  add column if not exists cuenta_sumup_id uuid references cuentas(id) on delete set null,
  add column if not exists categoria_cuota_id uuid references categorias(id) on delete set null;

-- Insertar categoria "Cuota socio CdP" si no existe. Tipo ingreso.
insert into categorias (nombre, tipo, activa)
select 'Cuota socio CdP', 'ingreso', true
where not exists (
  select 1 from categorias where lower(nombre) = lower('Cuota socio CdP')
);

-- Setear categoria_cuota_id default en la config si no esta seteada
update socio_config
set categoria_cuota_id = (
  select id from categorias where lower(nombre) = lower('Cuota socio CdP') limit 1
)
where id = 1 and categoria_cuota_id is null;
