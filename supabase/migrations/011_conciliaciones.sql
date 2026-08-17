-- 011_conciliaciones.sql
-- Reconciliacion bancaria: linkeo N:M entre lineas de cartola y movimientos
-- de la app. Una linea puede necesitar linkearse a varios movimientos (caso
-- clasico: giro cajero -$200.000 en BancoEstado = transferencia BancoChile
-- $150k + transferencia CajaChica $50k). Un movimiento tambien puede
-- linkearse a varias lineas si aparece dividido en la cartola.

create table if not exists conciliaciones (
  id uuid primary key default gen_random_uuid(),
  cartola_linea_id uuid not null references cartola_lineas(id) on delete cascade,
  movimiento_id uuid not null references movimientos(id) on delete cascade,
  auto boolean not null default false,
  ajuste_glosa text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cartola_linea_id, movimiento_id)
);
create index if not exists idx_conciliaciones_linea on conciliaciones (cartola_linea_id);
create index if not exists idx_conciliaciones_movimiento on conciliaciones (movimiento_id);

-- RLS solo directiva
alter table conciliaciones enable row level security;

drop policy if exists conciliaciones_directiva_all on conciliaciones;
create policy conciliaciones_directiva_all on conciliaciones
  for all using (is_directiva()) with check (is_directiva());

-- Trigger que mantiene el flag cartola_lineas.conciliado sincronizado con la
-- existencia de al menos una fila en conciliaciones para esa linea.
create or replace function actualizar_conciliado_linea()
returns trigger language plpgsql as $$
declare v_id uuid;
begin
  v_id := coalesce(new.cartola_linea_id, old.cartola_linea_id);
  update cartola_lineas
     set conciliado = exists (
       select 1 from conciliaciones c where c.cartola_linea_id = v_id
     )
   where id = v_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_conciliacion_ai on conciliaciones;
drop trigger if exists trg_conciliacion_ad on conciliaciones;
create trigger trg_conciliacion_ai after insert on conciliaciones
  for each row execute function actualizar_conciliado_linea();
create trigger trg_conciliacion_ad after delete on conciliaciones
  for each row execute function actualizar_conciliado_linea();
