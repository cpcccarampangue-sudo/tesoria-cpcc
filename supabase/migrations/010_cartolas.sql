-- 010_cartolas.sql
-- Almacenamiento y parseo de cartolas bancarias (Banco Estado y Banco Chile
-- por ahora). Cada cartola es un archivo Excel subido para una cuenta; al
-- subirse se parsea y se crean N filas en cartola_lineas. La reconciliacion
-- (cruzar lineas con movimientos de la app) va en la fase 5.

create table if not exists cartolas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas(id) on delete restrict,
  banco text not null,
  archivo_path text not null,
  archivo_nombre text,
  fecha_inicio date,
  fecha_fin date,
  filas_total int not null default 0,
  saldo_inicial numeric(12,0),
  saldo_final numeric(12,0),
  subida_por uuid references profiles(id) on delete set null,
  subida_en timestamptz not null default now()
);
create index if not exists idx_cartolas_cuenta on cartolas (cuenta_id, fecha_inicio desc);

create table if not exists cartola_lineas (
  id uuid primary key default gen_random_uuid(),
  cartola_id uuid not null references cartolas(id) on delete cascade,
  fila_num int not null,
  fecha date not null,
  descripcion text not null,
  monto numeric(12,0) not null check (monto > 0),
  tipo mov_tipo not null,
  canal text,
  saldo_despues numeric(12,0),
  referencia_externa text,
  conciliado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_cartola_lineas_cartola on cartola_lineas (cartola_id);
create index if not exists idx_cartola_lineas_fecha on cartola_lineas (fecha desc);
create index if not exists idx_cartola_lineas_no_conciliadas on cartola_lineas (cartola_id) where not conciliado;

-- RLS: solo directiva
alter table cartolas       enable row level security;
alter table cartola_lineas enable row level security;

drop policy if exists cartolas_directiva_all on cartolas;
create policy cartolas_directiva_all on cartolas
  for all using (is_directiva()) with check (is_directiva());

drop policy if exists cartola_lineas_directiva_all on cartola_lineas;
create policy cartola_lineas_directiva_all on cartola_lineas
  for all using (is_directiva()) with check (is_directiva());

-- Bucket Storage 'cartolas' privado
insert into storage.buckets (id, name, public)
values ('cartolas', 'cartolas', false)
on conflict (id) do nothing;

drop policy if exists cartolas_directiva_storage_select on storage.objects;
drop policy if exists cartolas_directiva_storage_insert on storage.objects;
drop policy if exists cartolas_directiva_storage_delete on storage.objects;

create policy cartolas_directiva_storage_select on storage.objects
  for select using (bucket_id = 'cartolas' and is_directiva());
create policy cartolas_directiva_storage_insert on storage.objects
  for insert with check (bucket_id = 'cartolas' and is_directiva());
create policy cartolas_directiva_storage_delete on storage.objects
  for delete using (bucket_id = 'cartolas' and is_directiva());
