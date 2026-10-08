-- 027_sumup_links_por_precio.sql
--
-- La cuenta SumUp del CdP soporta Payment Links fijos pero no la API
-- Online Payments (crearCheckout devuelve 401). Como workaround, en vez
-- de un unico sumup_link con monto preconfigurado, mantenemos dos:
--
--   sumup_link_promo  -> Payment Link SumUp con monto $18.500
--   sumup_link_normal -> Payment Link SumUp con monto $20.000
--
-- El codigo elige el link cuyo monto coincide EXACTAMENTE con el
-- monto_cuota snapshot de la solicitud (que fue decidido por
-- precioVigente() al crear la solicitud). Si no hay link para el monto
-- requerido, la pagina de pago muestra aviso en vez de un boton
-- que cobre el monto equivocado.
--
-- sumup_link queda deprecated y se eliminara en una migracion futura.

alter table socio_config
  add column if not exists sumup_link_promo text,
  add column if not exists sumup_link_normal text;

-- Backfill defensivo: si existe el sumup_link legacy, lo preservamos
-- como link normal (es el que estaba configurado para el precio
-- regular $20.000). La directiva puede ajustar despues desde /socios/config.
update socio_config
   set sumup_link_normal = sumup_link
 where id = 1
   and sumup_link_normal is null
   and sumup_link is not null;

comment on column socio_config.sumup_link is
  'DEPRECATED 2026-10-08: usar sumup_link_promo / sumup_link_normal segun el precio vigente. Esta columna ya no se lee en el codigo nuevo.';
