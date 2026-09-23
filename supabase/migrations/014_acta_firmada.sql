-- 014_acta_firmada.sql
-- Agrega 'acta_firmada' como tipo valido de adjunto de movimiento, para
-- distinguir el acta de recibo devuelta con firma de la contraparte
-- (proveedor, apoderado, etc.) del resto de comprobantes.

alter table movimiento_adjuntos
  drop constraint if exists movimiento_adjuntos_tipo_check;

alter table movimiento_adjuntos
  add constraint movimiento_adjuntos_tipo_check
  check (tipo in (
    'boleta',
    'comprobante',
    'cotizacion',
    'contrato',
    'foto',
    'acta_firmada',
    'otro'
  ));
