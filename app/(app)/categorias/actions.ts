"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MovTipo } from "@/lib/types";

export async function crearCategoria(input: {
  nombre: string;
  tipo: MovTipo;
}) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("categorias").insert({
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    activa: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/categorias");
}

export async function toggleCategoria(id: string, activa: boolean) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("categorias")
    .update({ activa })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/categorias");
}

export async function eliminarCategoria(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("categorias").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/categorias");
}
