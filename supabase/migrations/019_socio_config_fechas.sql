-- 019_socio_config_fechas.sql
-- Agrega fechas de inicio y fin al periodo de socios. Permite comenzar la
-- campaña del periodo siguiente con anticipacion (p.ej. campaña 2027
-- empieza en octubre 2026) y define el rango de validez del QR en los
-- eventos del CdP y convenios externos.
--
-- Reglas:
--   - periodo_inicio: desde cuando el QR acredita socio activo
--     (apoderados que pagan ANTES de esta fecha ya quedan incorporados
--     pero su QR solo "aparece activo" en el validador desde esta fecha).
--   - periodo_fin: hasta cuando el QR acredita socio activo. Pasada
--     esta fecha, el validador muestra "QR expirado".

alter table socio_config
  add column if not exists periodo_inicio date,
  add column if not exists periodo_fin date;

-- Backfill: si no hay fechas, poner inicio = 1 enero del periodo_anio y
-- fin = 31 diciembre del periodo_anio. La directiva puede ajustar
-- despues desde /socios/config.
update socio_config
set
  periodo_inicio = make_date(periodo_anio, 1, 1),
  periodo_fin = make_date(periodo_anio, 12, 31)
where id = 1
  and (periodo_inicio is null or periodo_fin is null);
