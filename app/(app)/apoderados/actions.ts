"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import Papa from "papaparse";

type ApoderadoInput = {
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  curso?: string | null;
  nombre_estudiante?: string | null;
  activo?: boolean;
};

function cleanEmail(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return null;
  return t;
}

export async function crearApoderado(input: ApoderadoInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("apoderados")
    .insert({
      nombre: input.nombre.trim(),
      email: cleanEmail(input.email),
      telefono: input.telefono?.trim() || null,
      curso: input.curso?.trim() || null,
      nombre_estudiante: input.nombre_estudiante?.trim() || null,
      activo: input.activo ?? true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/apoderados");
  return data.id;
}

export async function actualizarApoderado(id: string, input: ApoderadoInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("apoderados")
    .update({
      nombre: input.nombre.trim(),
      email: cleanEmail(input.email),
      telefono: input.telefono?.trim() || null,
      curso: input.curso?.trim() || null,
      nombre_estudiante: input.nombre_estudiante?.trim() || null,
      activo: input.activo ?? true,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/apoderados");
}

export async function toggleActivo(id: string, activo: boolean) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("apoderados")
    .update({ activo })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/apoderados");
}

export async function eliminarApoderado(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("apoderados").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/apoderados");
}

type ImportResult = {
  filas: number;
  insertados: number;
  actualizados: number;
  errores: { fila: number; motivo: string }[];
};

// Importa apoderados desde CSV pegado.
// Columnas esperadas (encabezado obligatorio, en cualquier orden):
//   nombre, email, telefono, curso, nombre_estudiante
export async function importarApoderadosCSV(
  csvText: string
): Promise<ImportResult> {
  await requireDirectiva();
  const admin = createSupabaseAdminClient();

  // Parse permisivo: acepta ; o , como delimitador.
  const parsed = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    delimitersToGuess: [",", ";", "\t"],
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      "No pude leer el CSV: " + parsed.errors.map((e) => e.message).join("; ")
    );
  }

  const rows = parsed.data;
  const result: ImportResult = {
    filas: rows.length,
    insertados: 0,
    actualizados: 0,
    errores: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nombre = (r.nombre ?? "").trim();
    if (!nombre) {
      result.errores.push({ fila: i + 2, motivo: "nombre vacío" });
      continue;
    }
    const email = cleanEmail(r.email);
    const payload = {
      nombre,
      email,
      telefono: (r.telefono ?? "").trim() || null,
      curso: (r.curso ?? "").trim() || null,
      nombre_estudiante: (r.nombre_estudiante ?? "").trim() || null,
      activo: true,
    };

    try {
      if (email) {
        // upsert por email
        const { data: existing } = await admin
          .from("apoderados")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        if (existing) {
          const { error } = await admin
            .from("apoderados")
            .update(payload)
            .eq("id", existing.id);
          if (error) throw error;
          result.actualizados++;
        } else {
          const { error } = await admin.from("apoderados").insert(payload);
          if (error) throw error;
          result.insertados++;
        }
      } else {
        // sin email: siempre insertamos (no hay clave para upsert)
        const { error } = await admin.from("apoderados").insert(payload);
        if (error) throw error;
        result.insertados++;
      }
    } catch (err) {
      result.errores.push({
        fila: i + 2,
        motivo: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath("/apoderados");
  return result;
}
