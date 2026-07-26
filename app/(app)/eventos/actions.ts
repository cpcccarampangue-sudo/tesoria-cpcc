"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function crearEvento(input: {
  nombre: string;
  descripcion: string | null;
  fecha: string | null;
}) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .insert({
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      fecha: input.fecha,
      cerrado: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/eventos");
  revalidatePath("/dashboard");
  return data.id;
}

export async function actualizarEvento(
  id: string,
  input: {
    nombre: string;
    descripcion: string | null;
    fecha: string | null;
    cerrado: boolean;
  }
) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("eventos")
    .update({
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      fecha: input.fecha,
      cerrado: input.cerrado,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/eventos");
  revalidatePath(`/eventos/${id}`);
  revalidatePath("/dashboard");
}

export async function eliminarEvento(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("eventos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/eventos");
  revalidatePath("/dashboard");
}
