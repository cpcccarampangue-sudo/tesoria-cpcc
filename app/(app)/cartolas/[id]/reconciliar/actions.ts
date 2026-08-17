"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calcularMatches, VENTANA_DIAS } from "@/lib/cartolas/matcher";
import type {
  LineaParaMatch,
  MovimientoParaMatch,
  ResultadoMatch,
} from "@/lib/cartolas/matcher";

// Recalcula el matching entre lineas sin conciliar de una cartola y los
// movimientos disponibles en la misma cuenta, dentro de la ventana temporal.
// No inserta nada — solo devuelve el analisis para pintar la UI.
export async function analizarReconciliacion(
  cartolaId: string
): Promise<{
  resultado: ResultadoMatch;
  lineasIndex: Record<string, LineaParaMatch & { descripcion: string }>;
  movsIndex: Record<
    string,
    MovimientoParaMatch & { cuenta_id: string; categoria_nombre: string | null }
  >;
}> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: cart } = await supabase
    .from("cartolas")
    .select("cuenta_id, fecha_inicio, fecha_fin")
    .eq("id", cartolaId)
    .maybeSingle();
  if (!cart) throw new Error("Cartola no encontrada.");

  const { data: lineasData } = await supabase
    .from("cartola_lineas")
    .select("id, fecha, monto, tipo, descripcion, conciliado")
    .eq("cartola_id", cartolaId)
    .eq("conciliado", false)
    .order("fecha")
    .order("fila_num");
  const lineas = (lineasData ?? []) as Array<{
    id: string;
    fecha: string;
    monto: number;
    tipo: "ingreso" | "egreso";
    descripcion: string;
    conciliado: boolean;
  }>;

  // Ventana de movimientos a considerar: min(fecha lineas) - N .. max(fecha lineas) + N
  const fechas = lineas.map((l) => l.fecha).sort();
  const minF = fechas[0] ?? cart.fecha_inicio ?? null;
  const maxF = fechas[fechas.length - 1] ?? cart.fecha_fin ?? null;
  function offsetDate(f: string, days: number): string {
    const d = new Date(f + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const desde = minF ? offsetDate(minF, -VENTANA_DIAS) : null;
  const hasta = maxF ? offsetDate(maxF, VENTANA_DIAS) : null;

  // Movimientos de la misma cuenta, dentro del rango, que no esten ya conciliados
  // con OTRA linea de la MISMA cartola (no queremos re-ofrecerlos).
  let movQuery = supabase
    .from("movimientos")
    .select(
      "id, fecha, monto, tipo, descripcion, es_transferencia, cuenta_id, categoria:categoria_id(nombre)"
    )
    .eq("cuenta_id", cart.cuenta_id);
  if (desde) movQuery = movQuery.gte("fecha", desde);
  if (hasta) movQuery = movQuery.lte("fecha", hasta);
  const { data: movsData } = await movQuery;
  const todosMovs = (movsData ?? []) as unknown as Array<{
    id: string;
    fecha: string;
    monto: number;
    tipo: "ingreso" | "egreso";
    descripcion: string | null;
    es_transferencia: boolean;
    cuenta_id: string;
    categoria: { nombre: string } | null;
  }>;

  // Filtrar movimientos que ya esten conciliados (con esta o cualquier cartola)
  const movIds = todosMovs.map((m) => m.id);
  let movsConciliados = new Set<string>();
  if (movIds.length > 0) {
    const { data: existing } = await supabase
      .from("conciliaciones")
      .select("movimiento_id")
      .in("movimiento_id", movIds);
    movsConciliados = new Set((existing ?? []).map((r) => r.movimiento_id));
  }

  const movsDisponibles = todosMovs.filter((m) => !movsConciliados.has(m.id));

  const lineasForMatch: LineaParaMatch[] = lineas.map((l) => ({
    id: l.id,
    fecha: l.fecha,
    monto: Number(l.monto),
    tipo: l.tipo,
  }));
  const movsForMatch: MovimientoParaMatch[] = movsDisponibles.map((m) => ({
    id: m.id,
    fecha: m.fecha,
    monto: Number(m.monto),
    tipo: m.tipo,
    descripcion: m.descripcion,
    es_transferencia: m.es_transferencia,
  }));

  const resultado = calcularMatches(lineasForMatch, movsForMatch);

  const lineasIndex: Record<
    string,
    LineaParaMatch & { descripcion: string }
  > = {};
  for (const l of lineas) {
    lineasIndex[l.id] = {
      id: l.id,
      fecha: l.fecha,
      monto: Number(l.monto),
      tipo: l.tipo,
      descripcion: l.descripcion,
    };
  }

  const movsIndex: Record<
    string,
    MovimientoParaMatch & {
      cuenta_id: string;
      categoria_nombre: string | null;
    }
  > = {};
  for (const m of movsDisponibles) {
    movsIndex[m.id] = {
      id: m.id,
      fecha: m.fecha,
      monto: Number(m.monto),
      tipo: m.tipo,
      descripcion: m.descripcion,
      es_transferencia: m.es_transferencia,
      cuenta_id: m.cuenta_id,
      categoria_nombre: m.categoria?.nombre ?? null,
    };
  }

  return { resultado, lineasIndex, movsIndex };
}

// Inserta todas las conciliaciones automaticas de una vez (los matches
// exactos 1:1 que devuelve calcularMatches).
export async function confirmarMatchesAutomaticos(input: {
  cartolaId: string;
  pares: Array<{ lineaId: string; movimientoId: string }>;
}): Promise<{ insertadas: number }> {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  if (input.pares.length === 0) return { insertadas: 0 };

  const rows = input.pares.map((p) => ({
    cartola_linea_id: p.lineaId,
    movimiento_id: p.movimientoId,
    auto: true,
    created_by: profile.id,
  }));

  const { error, count } = await supabase
    .from("conciliaciones")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(error.message);

  revalidatePath(`/cartolas/${input.cartolaId}`);
  revalidatePath(`/cartolas/${input.cartolaId}/reconciliar`);
  revalidatePath("/movimientos");
  return { insertadas: count ?? rows.length };
}

// Linkea manualmente una linea con uno o mas movimientos.
export async function conciliarManualmente(input: {
  cartolaId: string;
  lineaId: string;
  movimientoIds: string[];
  ajusteGlosa?: string | null;
}): Promise<{ insertadas: number }> {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  if (input.movimientoIds.length === 0) {
    throw new Error("Selecciona al menos un movimiento.");
  }

  const rows = input.movimientoIds.map((mid) => ({
    cartola_linea_id: input.lineaId,
    movimiento_id: mid,
    auto: false,
    ajuste_glosa: input.ajusteGlosa ?? null,
    created_by: profile.id,
  }));

  const { error, count } = await supabase
    .from("conciliaciones")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(error.message);

  revalidatePath(`/cartolas/${input.cartolaId}`);
  revalidatePath(`/cartolas/${input.cartolaId}/reconciliar`);
  revalidatePath("/movimientos");
  return { insertadas: count ?? rows.length };
}

// Deshace un vinculo (una fila en conciliaciones).
export async function desconciliar(input: {
  cartolaId: string;
  conciliacionId: string;
}): Promise<void> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("conciliaciones")
    .delete()
    .eq("id", input.conciliacionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/cartolas/${input.cartolaId}`);
  revalidatePath(`/cartolas/${input.cartolaId}/reconciliar`);
  revalidatePath("/movimientos");
}
