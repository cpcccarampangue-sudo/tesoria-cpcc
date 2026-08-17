"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CuentaTipo } from "@/lib/types";

type CuentaInput = {
  nombre: string;
  tipo: CuentaTipo;
  banco: string | null;
  titular: string | null;
  numero_cuenta: string | null;
  color: string | null;
};

export async function crearCuenta(input: CuentaInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: max } = await supabase
    .from("cuentas")
    .select("orden")
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orden = (max?.orden ?? 0) + 1;

  const { error } = await supabase.from("cuentas").insert({
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    banco: input.banco?.trim() || null,
    titular: input.titular?.trim() || null,
    numero_cuenta: input.numero_cuenta?.trim() || null,
    color: input.color?.trim() || null,
    orden,
    activa: true,
    es_principal: false,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/cuentas");
  revalidatePath("/dashboard");
}

export async function actualizarCuenta(id: string, input: CuentaInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("cuentas")
    .update({
      nombre: input.nombre.trim(),
      tipo: input.tipo,
      banco: input.banco?.trim() || null,
      titular: input.titular?.trim() || null,
      numero_cuenta: input.numero_cuenta?.trim() || null,
      color: input.color?.trim() || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cuentas");
  revalidatePath("/dashboard");
}

export async function toggleCuentaActiva(id: string, activa: boolean) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("cuentas")
    .update({ activa })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cuentas");
  revalidatePath("/dashboard");
}

export async function marcarComoPrincipal(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  // Desmarcar todas primero (respetando el unique index parcial).
  const { error: e1 } = await supabase
    .from("cuentas")
    .update({ es_principal: false })
    .eq("es_principal", true);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase
    .from("cuentas")
    .update({ es_principal: true })
    .eq("id", id);
  if (e2) throw new Error(e2.message);
  revalidatePath("/cuentas");
  revalidatePath("/dashboard");
}

export async function eliminarCuenta(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  // No permitir borrar la cuenta principal.
  const { data: c } = await supabase
    .from("cuentas")
    .select("es_principal")
    .eq("id", id)
    .single();
  if (c?.es_principal) {
    throw new Error(
      "No se puede eliminar la cuenta principal. Marca otra como principal primero."
    );
  }

  // No permitir borrar si tiene movimientos asociados.
  const { count } = await supabase
    .from("movimientos")
    .select("id", { count: "exact", head: true })
    .eq("cuenta_id", id);
  if ((count ?? 0) > 0) {
    throw new Error(
      `No se puede eliminar: hay ${count} movimiento(s) asociados a esta cuenta. Desactívala en su lugar.`
    );
  }

  const { error } = await supabase.from("cuentas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cuentas");
  revalidatePath("/dashboard");
}
