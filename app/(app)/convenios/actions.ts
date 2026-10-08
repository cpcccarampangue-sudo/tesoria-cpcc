"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizarEmail } from "@/lib/normalizar";
import type { Convenio, ConvenioConOperadores, ConvenioOperador } from "./tipos";

// Valida y normaliza la URL del logo. Solo acepta HTTPS (rechaza http,
// javascript:, data:, file:, etc.). Defensa contra XSS si la URL se
// renderiza en <img src> y contra downgrade a transporte inseguro.
// Trim, limite de largo razonable, vacio -> null. Usado en el admin
// manual y en el importador de planilla (fuentes no confiables).
function normalizarLogoUrl(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  if (v === "") return null;
  if (v.length > 2000) {
    throw new Error("La URL del logo es demasiado larga.");
  }
  if (!/^https:\/\/\S+$/i.test(v)) {
    throw new Error(
      "La URL del logo debe comenzar con https:// (sin espacios)."
    );
  }
  return v;
}

// Lista todos los convenios (activos e inactivos) con conteo de operadores.
// Solo directiva. La UI puede filtrar por active si quiere ocultar los
// desactivados.
export async function listarConvenios(): Promise<
  Array<Convenio & { operadoresActivos: number }>
> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const [{ data: convData }, { data: opData }] = await Promise.all([
    supabase
      .from("convenios")
      .select("*")
      .order("active", { ascending: false })
      .order("nombre"),
    supabase
      .from("convenio_operadores")
      .select("convenio_id")
      .eq("active", true),
  ]);
  const convenios = (convData as Convenio[] | null) ?? [];
  const conteo = new Map<string, number>();
  for (const o of (opData as Array<{ convenio_id: string }> | null) ?? []) {
    conteo.set(o.convenio_id, (conteo.get(o.convenio_id) ?? 0) + 1);
  }
  return convenios.map((c) => ({
    ...c,
    operadoresActivos: conteo.get(c.id) ?? 0,
  }));
}

export async function obtenerConvenio(
  id: string
): Promise<ConvenioConOperadores | null> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const [{ data: convData }, { data: opData }] = await Promise.all([
    supabase.from("convenios").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("convenio_operadores")
      .select("*")
      .eq("convenio_id", id)
      .order("active", { ascending: false })
      .order("email_normalized"),
  ]);
  const c = convData as Convenio | null;
  if (!c) return null;
  return {
    ...c,
    operadores: (opData as ConvenioOperador[] | null) ?? [],
  };
}

export type CrearConvenioInput = {
  nombre: string;
  descripcion?: string | null;
  logo_url?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
};

export async function crearConvenio(
  input: CrearConvenioInput
): Promise<string> {
  await requireDirectiva();
  const nombre = input.nombre.trim();
  if (nombre.length < 2) {
    throw new Error("El nombre del convenio debe tener al menos 2 caracteres.");
  }
  if (
    input.valid_from &&
    input.valid_until &&
    input.valid_from > input.valid_until
  ) {
    throw new Error("La fecha de inicio debe ser anterior a la fecha de fin.");
  }

  const logoUrl = normalizarLogoUrl(input.logo_url);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("convenios")
    .insert({
      nombre,
      descripcion: input.descripcion?.trim() || null,
      logo_url: logoUrl,
      valid_from: input.valid_from || null,
      valid_until: input.valid_until || null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "No se pudo crear el convenio.");
  }
  revalidatePath("/convenios");
  return data.id as string;
}

export type ActualizarConvenioInput = {
  id: string;
  nombre: string;
  descripcion?: string | null;
  logo_url?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  active?: boolean;
};

export async function actualizarConvenio(
  input: ActualizarConvenioInput
): Promise<void> {
  await requireDirectiva();
  const nombre = input.nombre.trim();
  if (nombre.length < 2) {
    throw new Error("El nombre del convenio debe tener al menos 2 caracteres.");
  }
  if (
    input.valid_from &&
    input.valid_until &&
    input.valid_from > input.valid_until
  ) {
    throw new Error("La fecha de inicio debe ser anterior a la fecha de fin.");
  }
  const logoUrl = normalizarLogoUrl(input.logo_url);
  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {
    nombre,
    descripcion: input.descripcion?.trim() || null,
    logo_url: logoUrl,
    valid_from: input.valid_from || null,
    valid_until: input.valid_until || null,
  };
  if (typeof input.active === "boolean") {
    patch.active = input.active;
  }
  const { error } = await supabase
    .from("convenios")
    .update(patch)
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  revalidatePath("/convenios");
  revalidatePath(`/convenios/${input.id}`);
}

// Desactivar en vez de borrar (soft delete). Preserva historial.
export async function desactivarConvenio(id: string): Promise<void> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("convenios")
    .update({ active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/convenios");
  revalidatePath(`/convenios/${id}`);
}

export async function reactivarConvenio(id: string): Promise<void> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("convenios")
    .update({ active: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/convenios");
  revalidatePath(`/convenios/${id}`);
}

// === Operadores ===

export async function agregarOperador(
  convenioId: string,
  email: string
): Promise<void> {
  await requireDirectiva();
  const emailNorm = normalizarEmail(email);
  if (!emailNorm) {
    throw new Error("El correo electrónico no es válido.");
  }
  const supabase = await createSupabaseServerClient();
  // Si ya existe (incluso inactivo), lo reactivamos en lugar de duplicar.
  const { data: existente } = await supabase
    .from("convenio_operadores")
    .select("id, active")
    .eq("convenio_id", convenioId)
    .eq("email_normalized", emailNorm)
    .maybeSingle();
  if (existente) {
    const row = existente as { id: string; active: boolean };
    if (!row.active) {
      const { error } = await supabase
        .from("convenio_operadores")
        .update({ active: true, revoked_at: null })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
    }
    revalidatePath(`/convenios/${convenioId}`);
    return;
  }
  const { error } = await supabase.from("convenio_operadores").insert({
    convenio_id: convenioId,
    email_normalized: emailNorm,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/convenios/${convenioId}`);
}

export async function revocarOperador(id: string): Promise<void> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: op } = await supabase
    .from("convenio_operadores")
    .select("convenio_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("convenio_operadores")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  if (op?.convenio_id) {
    revalidatePath(`/convenios/${op.convenio_id}`);
  }
  revalidatePath("/convenios");
}

export async function reactivarOperador(id: string): Promise<void> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: op } = await supabase
    .from("convenio_operadores")
    .select("convenio_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("convenio_operadores")
    .update({ active: true, revoked_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  if (op?.convenio_id) {
    revalidatePath(`/convenios/${op.convenio_id}`);
  }
  revalidatePath("/convenios");
}
