-- 024_socio_config_promocion.sql
--
-- Pricing con promocion: separa el precio normal del promocional y define
-- la ventana de vigencia como timestamptz. La columna legacy monto_cuota
-- queda DEPRECADA en codigo pero se mantiene en la base por rollback. Se
-- eliminara en una migracion futura (p.ej. 030_drop_monto_cuota).
--
-- Semantica del rango: inclusivo en inicio, exclusivo en fin. Garantiza
-- CERO gap horario entre promo y precio normal. Para que la promo cubra
-- "hasta el 2026-12-31 23:59:59 America/Santiago" inclusive, promocion_fin
-- debe ser 2027-01-01 00:00:00 America/Santiago (inicio de la ventana
-- siguiente).
--
-- Seed inicial: precios comerciales reales del CdP (ignora el valor legacy
-- de monto_cuota, que estaba en 100 CLP de prueba).

alter table socio_config
  add column if not exists monto_cuota_normal int,
  add column if not exists monto_cuota_promocional int,
  add column if not exists promocion_inicio timestamptz,
  add column if not exists promocion_fin timestamptz;

update socio_config
   set monto_cuota_normal      = coalesce(monto_cuota_normal, 20000),
       monto_cuota_promocional = coalesce(monto_cuota_promocional, 18500),
       promocion_inicio        = coalesce(
         promocion_inicio,
         (timestamp '2026-10-07 00:00:00' at time zone 'America/Santiago')
       ),
       promocion_fin           = coalesce(
         promocion_fin,
         (timestamp '2027-01-01 00:00:00' at time zone 'America/Santiago')
       )
 where id = 1;

alter table socio_config
  drop constraint if exists socio_config_promocion_coherente;
alter table socio_config
  add constraint socio_config_promocion_coherente check (
    (
      promocion_inicio is null
      and promocion_fin is null
      and monto_cuota_promocional is null
    )
    or
    (
      promocion_inicio is not null
      and promocion_fin is not null
      and monto_cuota_promocional is not null
      and promocion_fin > promocion_inicio
      and monto_cuota_promocional > 0
    )
  );

alter table socio_config
  drop constraint if exists socio_config_normal_positivo;
alter table socio_config
  add constraint socio_config_normal_positivo check (
    monto_cuota_normal is null or monto_cuota_normal > 0
  );

alter table socio_config
  drop constraint if exists socio_config_precios_coherentes;
alter table socio_config
  add constraint socio_config_precios_coherentes check (
    monto_cuota_promocional is null
    or monto_cuota_normal is null
    or monto_cuota_promocional <= monto_cuota_normal
  );

comment on column socio_config.monto_cuota is
  'DEPRECATED 2026-10-07: usar monto_cuota_normal / monto_cuota_promocional + promocion_inicio / promocion_fin. El codigo nuevo no lee esta columna. Eliminacion programada tras confirmar estabilidad.';
