"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MovTipo } from "@/lib/types";

type MovInput = {
  fecha: string;
  tipo: MovTipo;
  monto: number;
  descripcion: string | null;
  categoria_id: string | null;
  evento_id: string | null;
  cuenta_id: string;
  boleta_path?: string | null;
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
      boleta_path: input.boleta_path ?? null,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  revalidatePath("/eventos");
  if (input.evento_id) revalidatePath(`/eventos/${input.evento_id}`);
  return data.id;
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
      ...(input.boleta_path !== undefined
        ? { boleta_path: input.boleta_path }
        : {}),
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
  // (en cuyo caso hay que borrar tambien la contraparte) y para limpiar boletas.
  const { data: mov } = await supabase
    .from("movimientos")
    .select(
      "boleta_path, evento_id, es_transferencia, transferencia_par_id"
    )
    .eq("id", id)
    .single();

  const idsToDelete: string[] = [id];
  const boletasToRemove: string[] = [];
  if (mov?.boleta_path) boletasToRemove.push(mov.boleta_path);

  if (mov?.es_transferencia && mov.transferencia_par_id) {
    idsToDelete.push(mov.transferencia_par_id);
    const { data: par } = await supabase
      .from("movimientos")
      .select("boleta_path")
      .eq("id", mov.transferencia_par_id)
      .maybeSingle();
    if (par?.boleta_path && par.boleta_path !== mov.boleta_path) {
      boletasToRemove.push(par.boleta_path);
    }
  }

  const { error } = await supabase
    .from("movimientos")
    .delete()
    .in("id", idsToDelete);
  if (error) throw new Error(error.message);

  if (boletasToRemove.length > 0) {
    await supabase.storage.from("boletas").remove(boletasToRemove);
  }
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  revalidatePath("/eventos");
  if (mov?.evento_id) revalidatePath(`/eventos/${mov.evento_id}`);
}

// === TRANSFERENCIAS INTERNAS ===

type TransferenciaInput = {
  fecha: string;
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  monto: number;
  descripcion: string | null;
  boleta_path: string | null;
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
    p_boleta_path: input.boleta_path,
    p_created_by: profile.id,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  const origenId = row?.mov_origen_id as string | undefined;
  const destinoId = row?.mov_destino_id as string | undefined;
  if (!origenId || !destinoId) {
    throw new Error("La transferencia se ejecutó pero no devolvió IDs.");
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
