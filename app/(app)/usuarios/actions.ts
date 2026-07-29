"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

export async function cambiarRolUsuario(
  userId: string,
  nuevoRol: UserRole,
  cursoAsignado: string | null
) {
  const profile = await requireDirectiva();
  if (userId === profile.id && nuevoRol !== "directiva") {
    throw new Error(
      "No puedes quitarte tu propio rol de directiva (otro miembro debe hacerlo)."
    );
  }
  // curso_asignado solo tiene sentido para delegado
  const curso = nuevoRol === "delegado" ? cursoAsignado : null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: nuevoRol, curso_asignado: curso })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/usuarios");
}

export async function eliminarUsuario(userId: string) {
  const profile = await requireDirectiva();
  if (userId === profile.id) {
    throw new Error("No puedes eliminar tu propia cuenta.");
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  revalidatePath("/usuarios");
}

export async function vincularApoderado(
  userId: string,
  apoderadoId: string | null
) {
  await requireDirectiva();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ apoderado_id: apoderadoId })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/usuarios");
  revalidatePath("/dashboard");
}
