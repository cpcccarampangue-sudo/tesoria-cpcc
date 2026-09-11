"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaCargo } from "@/lib/types";

type CrearInput = {
  nombre: string;
  rut: string;
  cargo: DirectivaCargo;
  activo: boolean;
  orden?: number;
};

// Si el miembro nuevo va a quedar activo y ya existe otro activo con el mismo
// cargo, lo desactivamos primero (respeta la unique constraint parcial).
async function desactivarActivoDelCargo(cargo: DirectivaCargo) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("directiva_miembros")
    .update({ activo: false })
    .eq("cargo", cargo)
    .eq("activo", true);
  if (error) throw new Error(error.message);
}

export async function crearMiembroDirectiva(input: CrearInput) {
  await requireDirectiva();
  const nombre = input.nombre.trim();
  const rut = input.rut.trim();
  if (!nombre) throw new Error("Ingresa un nombre.");
  if (!rut) throw new Error("Ingresa el RUT.");
  if (input.activo) await desactivarActivoDelCargo(input.cargo);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("directiva_miembros").insert({
    nombre,
    rut,
    cargo: input.cargo,
    activo: input.activo,
    orden: input.orden ?? 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

export async function actualizarMiembroDirectiva(
  id: string,
  patch: { nombre?: string; rut?: string; cargo?: DirectivaCargo }
) {
  await requireDirectiva();
  const clean: Record<string, unknown> = {};
  if (patch.nombre !== undefined) clean.nombre = patch.nombre.trim();
  if (patch.rut !== undefined) clean.rut = patch.rut.trim();
  if (patch.cargo !== undefined) clean.cargo = patch.cargo;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("directiva_miembros")
    .update(clean)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

// Activa o desactiva un miembro. Si activa uno, desactiva primero al que
// tenga el mismo cargo activo (garantiza unicidad).
export async function toggleMiembroDirectiva(id: string, activo: boolean) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  if (activo) {
    // Buscamos el cargo del target y desactivamos al que este activo con ese cargo.
    const { data: target } = await supabase
      .from("directiva_miembros")
      .select("cargo")
      .eq("id", id)
      .maybeSingle();
    if (target?.cargo) await desactivarActivoDelCargo(target.cargo as DirectivaCargo);
  }
  const { error } = await supabase
    .from("directiva_miembros")
    .update({ activo })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

export async function eliminarMiembroDirectiva(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("directiva_miembros")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}
