-- 013_avance_reconciliacion.sql
-- Vista para mostrar el avance de reconciliacion (cuantas lineas del banco
-- ya estan vinculadas con un movimiento del sistema y cuantas quedan
-- pendientes). Usada en la pagina /cartolas para el panel de resumen por
-- cuenta y la columna "Reconciliado" de la tabla.

create or replace view v_conciliacion_por_cartola as
select
  cl.cartola_id,
  count(*)::int as total,
  count(*) filter (where cl.conciliado)::int as conciliadas,
  count(*) filter (where not cl.conciliado)::int as pendientes
from cartola_lineas cl
group by cl.cartola_id;

-- Grants: la vista hereda RLS de cartola_lineas, que solo directiva puede leer.
grant select on v_conciliacion_por_cartola to authenticated;
