"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AdjuntoTipo, MovTipo } from "@/lib/types";

type AdjuntoInput = {
  storage_path: string;
  nombre_original: string | null;
  tipo: AdjuntoTipo;
  descripcion: string | null;
};

type MovInput = {
  fecha: string;
  tipo: MovTipo;
  monto: number;
  descripcion: string | null;
  categoria_id: string | null;
  evento_id: string | null;
  cuenta_id: string;
  adjuntos_nuevos?: AdjuntoInput[];
};

export async function crearMovimiento(input: MovInput) {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  if (!input.cuenta_id) {
    throw new Error("Debes seleccionar una cuenta para el movimiento.");
  }
  const { data, error } = await supabase
    .from("movimientos")
    .insert({
      fecha: input.fecha,
      tipo: input.tipo,
      monto: input.monto,
      descripcion: input.descripcion,
      categoria_id: input.categoria_id,
      evento_id: input.evento_id,
      cuenta_id: input.cuenta_id,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const movId = data.id as string;
  if (input.adjuntos_nuevos && input.adjuntos_nuevos.length > 0) {
    const rows = input.adjuntos_nuevos.map((a) => ({
      movimiento_id: movId,
      storage_path: a.storage_path,
      nombre_original: a.nombre_original,
      tipo: a.tipo,
      descripcion: a.descripcion,
      subido_por: profile.id,
    }));
    const { error: e2 } = await supabase.from("movimiento_adjuntos").insert(rows);
    if (e2) {
      // No revertimos el movimiento: los adjuntos huerfanos en storage se
      // pueden reintentar; pero avisamos al caller para que sepa.
      throw new Error(`Movimiento creado pero fallaron los adjuntos: ${e2.message}`);
    }
  }

  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  revalidatePath("/eventos");
  if (input.evento_id) revalidatePath(`/eventos/${input.evento_id}`);
  return movId;
}

export async function actualizarMovimiento(id: string, input: MovInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  if (!input.cuenta_id) {
    throw new Error("Debes seleccionar una cuenta para el movimiento.");
  }
  const { error } = await supabase
    .from("movimientos")
    .update({
      fecha: input.fecha,
      tipo: input.tipo,
      monto: input.monto,
      descripcion: input.descripcion,
      categoria_id: input.categoria_id,
      evento_id: input.evento_id,
      cuenta_id: input.cuenta_id,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/movimientos");
  revalidatePath(`/movimientos/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  revalidatePath("/eventos");
}

export async function eliminarMovimiento(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  // Recuperar metadata para saber si es parte de una transferencia interna
  // (en cuyo caso hay que borrar tambien la contraparte).
  const { data: mov } = await supabase
    .from("movimientos")
    .select(
      "boleta_path, evento_id, es_transferencia, transferencia_par_id"
    )
    .eq("id", id)
    .single();

  const idsToDelete: string[] = [id];
  if (mov?.es_transferencia && mov.transferencia_par_id) {
    idsToDelete.push(mov.transferencia_par_id);
  }

  // Recolectar TODOS los paths de Storage a limpiar: los adjuntos multiples
  // (tabla movimiento_adjuntos) y el legacy boleta_path.
  const pathsToRemove = new Set<string>();
  const { data: adjuntos } = await supabase
    .from("movimiento_adjuntos")
    .select("storage_path, movimiento_id")
    .in("movimiento_id", idsToDelete);
  for (const a of adjuntos ?? []) pathsToRemove.add(a.storage_path);
  if (mov?.boleta_path) pathsToRemove.add(mov.boleta_path);
  if (mov?.es_transferencia && mov.transferencia_par_id) {
    const { data: par } = await supabase
      .from("movimientos")
      .select("boleta_path")
      .eq("id", mov.transferencia_par_id)
      .maybeSingle();
    if (par?.boleta_path) pathsToRemove.add(par.boleta_path);
  }

  // Delete movimientos (cascade borra tambien las filas de movimiento_adjuntos)
  const { error } = await supabase
    .from("movimientos")
    .delete()
    .in("id", idsToDelete);
  if (error) throw new Error(error.message);

  if (pathsToRemove.size > 0) {
    await supabase.storage.from("boletas").remove(Array.from(pathsToRemove));
  }
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  revalidatePath("/eventos");
  if (mov?.evento_id) revalidatePath(`/eventos/${mov.evento_id}`);
}

// === ADJUNTOS (para modo edicion: agregar/eliminar en tiempo real) ===

export async function agregarAdjunto(
  movimientoId: string,
  input: AdjuntoInput
) {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("movimiento_adjuntos")
    .insert({
      movimiento_id: movimientoId,
      storage_path: input.storage_path,
      nombre_original: input.nombre_original,
      tipo: input.tipo,
      descripcion: input.descripcion,
      subido_por: profile.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/movimientos/${movimientoId}`);
  revalidatePath("/movimientos");
  return data.id as string;
}

export async function eliminarAdjunto(adjuntoId: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: adj } = await supabase
    .from("movimiento_adjuntos")
    .select("storage_path, movimiento_id")
    .eq("id", adjuntoId)
    .maybeSingle();
  if (!adj) return;

  const { error } = await supabase
    .from("movimiento_adjuntos")
    .delete()
    .eq("id", adjuntoId);
  if (error) throw new Error(error.message);

  await supabase.storage.from("boletas").remove([adj.storage_path]);
  revalidatePath(`/movimientos/${adj.movimiento_id}`);
  revalidatePath("/movimientos");
}

export async function getAdjuntoSignedUrl(
  path: string
): Promise<string | null> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("boletas")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

// === TRANSFERENCIAS INTERNAS ===

type TransferenciaInput = {
  fecha: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  monto: number;
  descripcion: string | null;
  adjuntos_nuevos?: AdjuntoInput[];
};

export async function crearTransferenciaInterna(
  input: TransferenciaInput
): Promise<{ origenId: string; destinoId: string }> {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  if (input.cuenta_origen_id === input.cuenta_destino_id) {
    throw new Error("La cuenta origen y destino no pueden ser la misma.");
  }
  if (!input.monto || input.monto <= 0) {
    throw new Error("El monto debe ser mayor a 0.");
  }

  const { data, error } = await supabase.rpc("crear_transferencia_interna", {
    p_fecha: input.fecha,
    p_cuenta_origen: input.cuenta_origen_id,
    p_cuenta_destino: input.cuenta_destino_id,
    p_monto: input.monto,
    p_descripcion: input.descripcion,
    p_boleta_path: null,
    p_created_by: profile.id,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  const origenId = row?.mov_origen_id as string | undefined;
  const destinoId = row?.mov_destino_id as string | undefined;
  if (!origenId || !destinoId) {
    throw new Error("La transferencia se ejecutó pero no devolvió IDs.");
  }

  // Los adjuntos de la transferencia se asocian a AMBOS lados (mismo storage_path
  // referenciado dos veces, uno por movimiento). Al borrar la transferencia se
  // limpian todos los paths sin dejar huerfanos.
  if (input.adjuntos_nuevos && input.adjuntos_nuevos.length > 0) {
    const rows: Array<{
      movimiento_id: string;
      storage_path: string;
      nombre_original: string | null;
      tipo: AdjuntoTipo;
      descripcion: string | null;
      subido_por: string;
    }> = [];
    for (const a of input.adjuntos_nuevos) {
      for (const movId of [origenId, destinoId]) {
        rows.push({
          movimiento_id: movId,
          storage_path: a.storage_path,
          nombre_original: a.nombre_original,
          tipo: a.tipo,
          descripcion: a.descripcion,
          subido_por: profile.id,
        });
      }
    }
    const { error: e2 } = await supabase.from("movimiento_adjuntos").insert(rows);
    if (e2) {
      throw new Error(
        `Transferencia creada pero fallaron los adjuntos: ${e2.message}`
      );
    }
  }

  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");

  return { origenId, destinoId };
}

// Genera una signed URL temporal (1 h) para ver una boleta.
export async function getBoletaSignedUrl(path: string): Promise<string | null> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("boletas")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
