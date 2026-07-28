"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import Papa from "papaparse";

export type EstudianteInput = {
  id?: string; // presente al actualizar
  nombre: string;
  curso: string | null;
};

export type ApoderadoInput = {
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  activo?: boolean;
  estudiantes?: EstudianteInput[];
};

function cleanEmail(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return null;
  return t;
}

function normalizarEstudiantes(
  raw: EstudianteInput[] | undefined
): { nombre: string; curso: string | null }[] {
  if (!raw) return [];
  return raw
    .map((e) => ({
      nombre: e.nombre.trim(),
      curso: e.curso?.trim() || null,
    }))
    .filter((e) => e.nombre.length > 0);
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
      activo: input.activo ?? true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const estudiantes = normalizarEstudiantes(input.estudiantes);
  if (estudiantes.length > 0) {
    const { error: e2 } = await supabase.from("estudiantes").insert(
      estudiantes.map((e) => ({
        apoderado_id: data.id,
        nombre: e.nombre,
        curso: e.curso,
        activo: true,
      }))
    );
    if (e2) throw new Error(e2.message);
  }

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
      activo: input.activo ?? true,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Sincronizar estudiantes: los que no vengan en la lista se eliminan.
  const estudiantes = normalizarEstudiantes(input.estudiantes);
  const conId = (input.estudiantes ?? []).filter((e) => e.id);
  const idsAKeep = conId.map((e) => e.id!) as string[];

  if (idsAKeep.length > 0) {
    await supabase
      .from("estudiantes")
      .delete()
      .eq("apoderado_id", id)
      .not("id", "in", `(${idsAKeep.map((x) => `"${x}"`).join(",")})`);
  } else {
    await supabase.from("estudiantes").delete().eq("apoderado_id", id);
  }

  // Actualizar los existentes
  for (const e of conId) {
    await supabase
      .from("estudiantes")
      .update({
        nombre: e.nombre.trim(),
        curso: e.curso?.trim() || null,
      })
      .eq("id", e.id!);
  }

  // Insertar los nuevos (sin id)
  const nuevos = estudiantes.filter(
    (e, i) => !(input.estudiantes ?? [])[i]?.id
  );
  if (nuevos.length > 0) {
    await supabase.from("estudiantes").insert(
      nuevos.map((e) => ({
        apoderado_id: id,
        nombre: e.nombre,
        curso: e.curso,
        activo: true,
      }))
    );
  }

  revalidatePath("/apoderados");
  revalidatePath(`/apoderados/${id}`);
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
  estudiantesInsertados: number;
  errores: { fila: number; motivo: string }[];
};

// Importa apoderados desde CSV pegado.
// Columnas esperadas (encabezado obligatorio, en cualquier orden):
//   nombre, email, telefono, estudiantes
// Formato del campo 'estudiantes':
//   "Nombre1:Curso1; Nombre2:Curso2"   (usa ';' entre estudiantes y ':' entre nombre y curso)
// También se acepta la columna 'nombre_estudiante' y 'curso' (legacy) para retrocompatibilidad.
export async function importarApoderadosCSV(
  csvText: string
): Promise<ImportResult> {
  await requireDirectiva();
  const admin = createSupabaseAdminClient();

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
    estudiantesInsertados: 0,
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
      activo: true,
    };

    // Parse estudiantes desde la columna 'estudiantes' (formato "Nombre:Curso; Nombre:Curso")
    // o desde 'nombre_estudiante' + 'curso' (legacy).
    let estudiantes: { nombre: string; curso: string | null }[] = [];
    const estCol = (r.estudiantes ?? "").trim();
    if (estCol) {
      estudiantes = estCol
        .split(";")
        .map((chunk) => {
          const [n, c] = chunk.split(":").map((s) => s.trim());
          if (!n) return null;
          return { nombre: n, curso: c || null };
        })
        .filter((x): x is { nombre: string; curso: string | null } => !!x);
    } else if (r.nombre_estudiante) {
      const legacyNombre = r.nombre_estudiante.trim();
      const legacyCurso = (r.curso ?? "").trim() || null;
      if (legacyNombre) estudiantes = [{ nombre: legacyNombre, curso: legacyCurso }];
    }

    try {
      let apoderadoId: string;
      if (email) {
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
          apoderadoId = existing.id;
          result.actualizados++;
        } else {
          const { data, error } = await admin
            .from("apoderados")
            .insert(payload)
            .select("id")
            .single();
          if (error) throw error;
          apoderadoId = data.id;
          result.insertados++;
        }
      } else {
        const { data, error } = await admin
          .from("apoderados")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        apoderadoId = data.id;
        result.insertados++;
      }

      if (estudiantes.length > 0) {
        // Reemplazar estudiantes existentes por los del CSV (para que reimportar quede consistente)
        await admin.from("estudiantes").delete().eq("apoderado_id", apoderadoId);
        const { error: eEst } = await admin.from("estudiantes").insert(
          estudiantes.map((e) => ({
            apoderado_id: apoderadoId,
            nombre: e.nombre,
            curso: e.curso,
            activo: true,
          }))
        );
        if (eEst) throw eEst;
        result.estudiantesInsertados += estudiantes.length;
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
