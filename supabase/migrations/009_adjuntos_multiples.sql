-- 009_adjuntos_multiples.sql
-- Cada movimiento puede tener multiples archivos adjuntos (boleta, comprobante,
-- cotizacion, contrato, foto, etc.), no uno solo. Se reemplaza el uso de la
-- columna movimientos.boleta_path por una tabla dedicada movimiento_adjuntos.
-- La columna boleta_path se conserva por retrocompatibilidad y se backfillea a
-- la tabla nueva como adjunto tipo 'boleta'. Nuevos movimientos guardan sus
-- archivos solo en la tabla nueva.

create table if not exists movimiento_adjuntos (
  id uuid primary key default gen_random_uuid(),
  movimiento_id uuid not null references movimientos(id) on delete cascade,
  storage_path text not null,
  nombre_original text,
  tipo text not null default 'otro'
    check (tipo in ('boleta', 'comprobante', 'cotizacion', 'contrato', 'foto', 'otro')),
  descripcion text,
  subido_por uuid references profiles(id) on delete set null,
  subido_en timestamptz not null default now()
);

create index if not exists idx_movimiento_adjuntos_mov
  on movimiento_adjuntos (movimiento_id);

-- RLS: solo directiva
alter table movimiento_adjuntos enable row level security;

drop policy if exists adjuntos_directiva_all on movimiento_adjuntos;
create policy adjuntos_directiva_all on movimiento_adjuntos
  for all using (is_directiva()) with check (is_directiva());

-- Backfill: cada movimiento con boleta_path pasa a tener un adjunto tipo 'boleta'.
insert into movimiento_adjuntos (movimiento_id, storage_path, tipo, subido_por, subido_en)
select m.id, m.boleta_path, 'boleta', m.created_by, m.created_at
from movimientos m
where m.boleta_path is not null
  and not exists (
    select 1 from movimiento_adjuntos a
    where a.movimiento_id = m.id and a.storage_path = m.boleta_path
  );
