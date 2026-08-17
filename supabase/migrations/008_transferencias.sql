-- 008_transferencias.sql
-- Transferencias internas entre cuentas: la plata se mueve de una cuenta a
-- otra sin ser un ingreso ni egreso "real" del CdP. Se modela como DOS filas
-- en movimientos (una egreso desde la cuenta origen, una ingreso en la cuenta
-- destino) linkeadas por transferencia_par_id. La bandera es_transferencia
-- las excluye del balance total agregado (para no contarlas doble o inflar
-- ingresos/egresos), pero se cuentan normalmente en el balance por cuenta.

alter table movimientos
  add column if not exists es_transferencia boolean not null default false;

alter table movimientos
  add column if not exists transferencia_par_id uuid references movimientos(id) on delete set null;

create index if not exists idx_movimientos_transferencia_par
  on movimientos (transferencia_par_id)
  where transferencia_par_id is not null;

-- Actualizar v_balance_general para EXCLUIR las transferencias internas del
-- total de ingresos y egresos (asi los KPIs del dashboard reflejan solo la
-- plata real que entra o sale del CdP).
create or replace view v_balance_general as
select
  coalesce(sum(monto) filter (where tipo = 'ingreso' and not es_transferencia), 0)::numeric as total_ingresos,
  coalesce(sum(monto) filter (where tipo = 'egreso'  and not es_transferencia), 0)::numeric as total_egresos,
  (coalesce(sum(monto) filter (where tipo = 'ingreso' and not es_transferencia), 0)
   - coalesce(sum(monto) filter (where tipo = 'egreso'  and not es_transferencia), 0))::numeric as saldo
from movimientos;

-- === FUNCION crear_transferencia_interna ===
-- Inserta atomicamente las 2 filas de una transferencia entre cuentas y las
-- linkea por transferencia_par_id. Toda la funcion corre en la transaccion
-- del caller: si algo falla, la insercion queda deshecha.
create or replace function crear_transferencia_interna(
  p_fecha date,
  p_cuenta_origen uuid,
  p_cuenta_destino uuid,
  p_monto numeric,
  p_descripcion text,
  p_boleta_path text,
  p_created_by uuid
) returns table(mov_origen_id uuid, mov_destino_id uuid)
language plpgsql as $$
declare
  v_origen_id uuid;
  v_destino_id uuid;
begin
  if p_cuenta_origen is null or p_cuenta_destino is null then
    raise exception 'Debes seleccionar cuenta origen y cuenta destino.';
  end if;
  if p_cuenta_origen = p_cuenta_destino then
    raise exception 'La cuenta origen y destino no pueden ser la misma.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.';
  end if;

  -- Egreso desde la cuenta origen
  insert into movimientos (
    fecha, tipo, monto, descripcion,
    cuenta_id, es_transferencia,
    boleta_path, created_by
  ) values (
    p_fecha, 'egreso', p_monto, p_descripcion,
    p_cuenta_origen, true,
    p_boleta_path, p_created_by
  ) returning id into v_origen_id;

  -- Ingreso en la cuenta destino, ya linkeado al origen
  insert into movimientos (
    fecha, tipo, monto, descripcion,
    cuenta_id, es_transferencia, transferencia_par_id,
    boleta_path, created_by
  ) values (
    p_fecha, 'ingreso', p_monto, p_descripcion,
    p_cuenta_destino, true, v_origen_id,
    p_boleta_path, p_created_by
  ) returning id into v_destino_id;

  -- Cerrar el par: actualizar el origen con el id del destino
  update movimientos set transferencia_par_id = v_destino_id where id = v_origen_id;

  mov_origen_id := v_origen_id;
  mov_destino_id := v_destino_id;
  return next;
end;
$$;

grant execute on function crear_transferencia_interna(date, uuid, uuid, numeric, text, text, uuid) to authenticated;
