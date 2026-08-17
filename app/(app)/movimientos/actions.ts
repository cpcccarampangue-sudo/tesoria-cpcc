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

  // Recuperar path de boleta para borrarla también
  const { data: mov } = await supabase
    .from("movimientos")
    .select("boleta_path, evento_id")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("movimientos").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (mov?.boleta_path) {
    await supabase.storage.from("boletas").remove([mov.boleta_path]);
  }
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  revalidatePath("/eventos");
  if (mov?.evento_id) revalidatePath(`/eventos/${mov.evento_id}`);
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
