"use server";

import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LibroCajaRow = {
  fecha: string;
  tipo: string;
  monto: number;
  categoria: string | null;
  evento: string | null;
  cuenta: string | null;
  descripcion: string | null;
};

// Categorias que NO son operacionales y se excluyen de los reportes:
//   - "Saldo apertura": ajustes contables que representan plata pre-existente
//     al momento del switch al sistema; distorsionarian ingresos/egresos.
const CATEGORIAS_EXCLUIDAS_REPORTES = new Set<string>(["Saldo apertura"]);

export async function fetchLibroCaja(
  desde: string | null,
  hasta: string | null
): Promise<LibroCajaRow[]> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("movimientos")
    .select(
      "fecha, tipo, monto, descripcion, es_transferencia, categoria:categoria_id(nombre), evento:evento_id(nombre), cuenta:cuenta_id(nombre)"
    )
    .eq("es_transferencia", false)
    .order("fecha", { ascending: true })
    .order("created_at", { ascending: true });
  if (desde) q = q.gte("fecha", desde);
  if (hasta) q = q.lte("fecha", hasta);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Row = {
    fecha: string;
    tipo: string;
    monto: number;
    descripcion: string | null;
    es_transferencia: boolean;
    categoria: { nombre: string } | null;
    evento: { nombre: string } | null;
    cuenta: { nombre: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .filter(
      (r) => !CATEGORIAS_EXCLUIDAS_REPORTES.has(r.categoria?.nombre ?? "")
    )
    .map((r) => ({
      fecha: r.fecha,
      tipo: r.tipo,
      monto: Number(r.monto),
      categoria: r.categoria?.nombre ?? null,
      evento: r.evento?.nombre ?? null,
      cuenta: r.cuenta?.nombre ?? null,
      descripcion: r.descripcion,
    }));
}

export type BalanceEventoRow = {
  nombre: string;
  fecha: string | null;
  ingresos: number;
  egresos: number;
  neto: number;
};

export async function fetchBalanceEventos(): Promise<BalanceEventoRow[]> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_balance_por_evento")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = {
    nombre: string;
    fecha: string | null;
    ingresos: number;
    egresos: number;
    neto: number;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows.map((r) => ({
    nombre: r.nombre,
    fecha: r.fecha,
    ingresos: Number(r.ingresos),
    egresos: Number(r.egresos),
    neto: Number(r.neto),
  }));
}

export type EstadoCuotasRow = {
  apoderado: string;
  curso: string | null;
  periodo: string;
  monto: number;
  pagado: number;
  saldo: number;
  estado: string;
};

export async function fetchEstadoCuotas(): Promise<EstadoCuotasRow[]> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_cuota_estado_apoderado")
    .select("*")
    .order("nombre");
  if (error) throw new Error(error.message);
  type Row = {
    nombre: string;
    curso: string | null;
    periodo: string;
    monto_periodo: number;
    pagado: number;
    estado: string;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows.map((r) => ({
    apoderado: r.nombre,
    curso: r.curso,
    periodo: r.periodo,
    monto: Number(r.monto_periodo),
    pagado: Number(r.pagado),
    saldo: Number(r.monto_periodo) - Number(r.pagado),
    estado: r.estado,
  }));
}
