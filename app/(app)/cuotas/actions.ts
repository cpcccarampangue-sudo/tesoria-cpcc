"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CuotaEstado } from "@/lib/types";

// === PERIODOS ===

export async function crearPeriodo(input: {
  nombre: string;
  monto: number;
  fecha_vencimiento: string | null;
}) {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: periodo, error } = await supabase
    .from("cuota_periodos")
    .insert({
      nombre: input.nombre,
      monto: input.monto,
      fecha_vencimiento: input.fecha_vencimiento,
      activa: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Generar filas de cuota_pagos para todos los apoderados activos.
  const { data: apoderados } = await supabase
    .from("apoderados")
    .select("id")
    .eq("activo", true);

  let pagosCreados = 0;
  if (apoderados && apoderados.length > 0) {
    const rows = apoderados.map((a) => ({
      periodo_id: periodo.id,
      apoderado_id: a.id,
      monto_pagado: 0,
      estado: "pendiente" as CuotaEstado,
    }));
    const { error: e2, count } = await supabase
      .from("cuota_pagos")
      .insert(rows, { count: "exact" });
    if (e2) throw new Error(e2.message);
    pagosCreados = count ?? rows.length;
  }

  revalidatePath("/cuotas");
  revalidatePath("/cuotas/periodos");
  void profile;
  return { pagosCreados };
}

export async function togglePeriodoActivo(id: string, activa: boolean) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("cuota_periodos")
    .update({ activa })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cuotas/periodos");
  revalidatePath("/cuotas");
}

export async function eliminarPeriodo(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("cuota_periodos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cuotas/periodos");
  revalidatePath("/cuotas");
}

// === PAGOS ===

// Marca un pago (o lo actualiza). Si se pasa createMovimiento=true, crea
// un ingreso en 'movimientos' con categoría "Cuota apoderado" ligado a este pago.
export async function registrarPago(input: {
  pago_id: string;
  monto_pagado: number;
  estado: CuotaEstado;
  fecha_pago: string | null;
  nota: string | null;
  crear_movimiento: boolean;
  cuenta_id: string | null;
}) {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: pago, error: e0 } = await supabase
    .from("cuota_pagos")
    .select("id, periodo_id, apoderado_id")
    .eq("id", input.pago_id)
    .single();
  if (e0 || !pago) throw new Error(e0?.message ?? "Pago no encontrado");

  const { error: e1 } = await supabase
    .from("cuota_pagos")
    .update({
      monto_pagado: input.monto_pagado,
      estado: input.estado,
      fecha_pago: input.fecha_pago,
      nota: input.nota,
    })
    .eq("id", input.pago_id);
  if (e1) throw new Error(e1.message);

  if (
    input.crear_movimiento &&
    input.monto_pagado > 0 &&
    (input.estado === "pagada" || input.estado === "parcial")
  ) {
    // Resolver cuenta destino: la explicita del input, o la principal como fallback.
    let cuentaId = input.cuenta_id;
    if (!cuentaId) {
      const { data: principal } = await supabase
        .from("cuentas")
        .select("id")
        .eq("es_principal", true)
        .eq("activa", true)
        .maybeSingle();
      cuentaId = principal?.id ?? null;
    }
    if (!cuentaId) {
      throw new Error(
        "No hay una cuenta principal configurada. Ve a Cuentas y marca una como principal antes de registrar pagos."
      );
    }

    // Buscar categoría "Cuota apoderado"
    const { data: cat } = await supabase
      .from("categorias")
      .select("id")
      .eq("nombre", "Cuota apoderado")
      .maybeSingle();

    // Buscar nombre del apoderado para la descripción
    const { data: apo } = await supabase
      .from("apoderados")
      .select("nombre")
      .eq("id", pago.apoderado_id)
      .single();
    const { data: per } = await supabase
      .from("cuota_periodos")
      .select("nombre")
      .eq("id", pago.periodo_id)
      .single();

    // ¿Ya existe un movimiento para este pago?
    const { data: existing } = await supabase
      .from("movimientos")
      .select("id")
      .eq("cuota_pago_id", input.pago_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("movimientos")
        .update({
          monto: input.monto_pagado,
          fecha: input.fecha_pago ?? new Date().toISOString().slice(0, 10),
          descripcion: `${per?.nombre ?? "Cuota"} — ${apo?.nombre ?? ""}`,
          cuenta_id: cuentaId,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("movimientos").insert({
        fecha: input.fecha_pago ?? new Date().toISOString().slice(0, 10),
        tipo: "ingreso",
        monto: input.monto_pagado,
        descripcion: `${per?.nombre ?? "Cuota"} — ${apo?.nombre ?? ""}`,
        categoria_id: cat?.id ?? null,
        cuota_pago_id: input.pago_id,
        cuenta_id: cuentaId,
        created_by: profile.id,
      });
    }
  }

  revalidatePath("/cuotas");
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
}
