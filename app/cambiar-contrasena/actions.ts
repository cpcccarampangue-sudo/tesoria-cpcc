"use server";

import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function cambiarContrasenaTemporal(nuevaContrasena: string) {
  const profile = await requireProfile();

  if (nuevaContrasena.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }

  // 1. Actualizar la contraseña usando el cliente autenticado del usuario
  // actual (así Supabase valida que hay sesión activa).
  const supabase = await createSupabaseServerClient();
  const { error: eAuth } = await supabase.auth.updateUser({
    password: nuevaContrasena,
  });
  if (eAuth) throw new Error(eAuth.message);

  // 2. Bajar el flag first_login para que el layout deje pasar.
  const admin = createSupabaseAdminClient();
  const { error: eProf } = await admin
    .from("profiles")
    .update({ first_login: false })
    .eq("id", profile.id);
  if (eProf) throw new Error(eProf.message);

  revalidatePath("/dashboard");
}
