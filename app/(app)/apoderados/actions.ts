"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContactoRelacion } from "@/lib/types";
import Papa from "papaparse";

export type EstudianteInput = {
  id?: string;
  nombre: string;
  curso: string | null;
};

export type ContactoInput = {
  id?: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  relacion: ContactoRelacion;
};

export type ApoderadoInput = {
  nombre: string; // rótulo familia (ej. "Familia Cáceres")
  activo?: boolean;
  socio?: boolean;
  contactos?: ContactoInput[];
  estudiantes?: EstudianteInput[];
};

function cleanEmail(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return null;
  return t;
}

function normalizarEstudiantes(raw: EstudianteInput[] | undefined) {
  if (!raw) return [];
  return raw
    .map((e) => ({
      id: e.id,
      nombre: e.nombre.trim(),
      curso: e.curso?.trim() || null,
    }))
    .filter((e) => e.nombre.length > 0);
}

function normalizarContactos(raw: ContactoInput[] | undefined) {
  if (!raw) return [];
  return raw
    .map((c) => ({
      id: c.id,
      nombre: c.nombre.trim(),
      email: cleanEmail(c.email),
      telefono: c.telefono?.trim() || null,
      relacion: c.relacion ?? "otro",
    }))
    .filter((c) => c.nombre.length > 0);
}

export async function crearApoderado(input: ApoderadoInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("apoderados")
    .insert({
      nombre: input.nombre.trim(),
      activo: input.activo ?? true,
      socio: input.socio ?? true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const contactos = normalizarContactos(input.contactos);
  if (contactos.length > 0) {
    const { error: eC } = await supabase.from("contactos").insert(
      contactos.map((c) => ({
        apoderado_id: data.id,
        nombre: c.nombre,
        email: c.email,
        telefono: c.telefono,
        relacion: c.relacion,
        activo: true,
      }))
    );
    if (eC) throw new Error(eC.message);
  }

  const estudiantes = normalizarEstudiantes(input.estudiantes);
  if (estudiantes.length > 0) {
    const { error: eE } = await supabase.from("estudiantes").insert(
      estudiantes.map((e) => ({
        apoderado_id: data.id,
        nombre: e.nombre,
        curso: e.curso,
        activo: true,
      }))
    );
    if (eE) throw new Error(eE.message);
  }

  revalidatePath("/apoderados");
  return data.id;
}

async function syncChildren<T extends { id?: string; nombre: string }>(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: "contactos" | "estudiantes",
  apoderadoId: string,
  items: T[],
  buildRow: (i: T) => Record<string, unknown>
) {
  const conId = items.filter((i) => i.id);
  const idsAKeep = conId.map((i) => i.id!) as string[];

  if (idsAKeep.length > 0) {
    await supabase
      .from(table)
      .delete()
      .eq("apoderado_id", apoderadoId)
      .not("id", "in", `(${idsAKeep.map((x) => `"${x}"`).join(",")})`);
  } else {
    await supabase.from(table).delete().eq("apoderado_id", apoderadoId);
  }

  for (const item of conId) {
    await supabase.from(table).update(buildRow(item)).eq("id", item.id!);
  }

  const nuevos = items.filter((i) => !i.id);
  if (nuevos.length > 0) {
    await supabase
      .from(table)
      .insert(
        nuevos.map((n) => ({ apoderado_id: apoderadoId, ...buildRow(n) }))
      );
  }
}

export async function actualizarApoderado(id: string, input: ApoderadoInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("apoderados")
    .update({
      nombre: input.nombre.trim(),
      activo: input.activo ?? true,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  const contactos = normalizarContactos(input.contactos);
  await syncChildren(supabase, "contactos", id, contactos, (c) => ({
    nombre: c.nombre,
    email: c.email,
    telefono: c.telefono,
    relacion: c.relacion,
    activo: true,
  }));

  const estudiantes = normalizarEstudiantes(input.estudiantes);
  await syncChildren(supabase, "estudiantes", id, estudiantes, (e) => ({
    nombre: e.nombre,
    curso: e.curso,
    activo: true,
  }));

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

// =============================================================================
// INVITAR CONTACTOS: pre-crea cuentas de auth para los contactos con correo de
// una familia. Cada cuenta recibe una contraseña temporal autogenerada; al
// primer ingreso la persona debe cambiarla. La directiva recibe la lista para
// compartir por WhatsApp/correo (los correos NO se envían desde Supabase por
// el rate limit del plan gratuito).
// =============================================================================

export type InvitacionResultado = {
  email: string;
  nombre: string;
  status: "creada" | "ya-existe" | "error";
  password: string | null;
  motivo?: string;
};

function generarPasswordTemporal(): string {
  // Sin caracteres ambiguos (l, 1, i, I, o, 0, O).
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const block = () =>
    Array.from({ length: 4 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
  return `cpcc-${block()}-${block()}`;
}

export async function invitarContactosDeApoderado(
  apoderadoId: string
): Promise<InvitacionResultado[]> {
  await requireDirectiva();
  const admin = createSupabaseAdminClient();

  const { data: contactos, error: eC } = await admin
    .from("contactos")
    .select("id, email, nombre")
    .eq("apoderado_id", apoderadoId)
    .not("email", "is", null)
    .eq("activo", true);
  if (eC) throw new Error("Buscando contactos: " + eC.message);

  const resultados: InvitacionResultado[] = [];

  for (const c of contactos ?? []) {
    if (!c.email) continue;
    const email = c.email.toLowerCase();

    // ¿Ya tiene profile? (creado por el trigger si el auth.user ya existe).
    const { data: yaTiene } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (yaTiene) {
      resultados.push({
        email,
        nombre: c.nombre,
        status: "ya-existe",
        password: null,
      });
      continue;
    }

    const password = generarPasswordTemporal();

    const { error: eCreate } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (eCreate) {
      resultados.push({
        email,
        nombre: c.nombre,
        status: "error",
        password: null,
        motivo: eCreate.message,
      });
      continue;
    }

    // El trigger handle_new_user creó el profile con role=apoderado y
    // apoderado_id vinculado. Le marcamos first_login=true.
    const { error: eUpd } = await admin
      .from("profiles")
      .update({ first_login: true })
      .eq("email", email);
    if (eUpd) {
      resultados.push({
        email,
        nombre: c.nombre,
        status: "error",
        password: null,
        motivo: "creada pero no marcada como primer login: " + eUpd.message,
      });
      continue;
    }

    resultados.push({ email, nombre: c.nombre, status: "creada", password });
  }

  revalidatePath("/apoderados");
  revalidatePath("/usuarios");
  return resultados;
}

type ImportResult = {
  filas: number;
  insertados: number;
  actualizados: number;
  contactosInsertados: number;
  estudiantesInsertados: number;
  errores: { fila: number; motivo: string }[];
};

// CSV esperado (encabezado obligatorio, cualquier orden):
//   nombre                   → rótulo de familia (obligatorio)
//   contactos                → "Nombre:email:telefono:relacion; Nombre:email:tel:rel"
//                              relacion en {padre, madre, tutor, otro}
//   estudiantes              → "Nombre:Curso; Nombre:Curso"
// Legacy soportado: email, telefono, nombre_estudiante, curso (se importan como
// primer contacto + primer estudiante).
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
    contactosInsertados: 0,
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

    // Parse contactos
    let contactos: {
      nombre: string;
      email: string | null;
      telefono: string | null;
      relacion: ContactoRelacion;
    }[] = [];
    const ctxCol = (r.contactos ?? "").trim();
    if (ctxCol) {
      contactos = ctxCol
        .split(";")
        .map((chunk) => {
          const [n, em, tel, rel] = chunk.split(":").map((s) => s.trim());
          if (!n) return null;
          const valid: ContactoRelacion[] = [
            "padre",
            "madre",
            "apoderado_cuenta",
            "apoderado_academico",
            "otro",
          ];
          const relacion: ContactoRelacion = valid.includes(
            rel as ContactoRelacion
          )
            ? (rel as ContactoRelacion)
            : "otro";
          return {
            nombre: n,
            email: cleanEmail(em),
            telefono: tel || null,
            relacion,
          };
        })
        .filter(
          (
            x
          ): x is {
            nombre: string;
            email: string | null;
            telefono: string | null;
            relacion: ContactoRelacion;
          } => !!x
        );
    } else {
      // Legacy: usa email + telefono + nombre del apoderado
      const em = cleanEmail(r.email);
      const tel = (r.telefono ?? "").trim() || null;
      if (em || tel) {
        contactos = [
          {
            nombre,
            email: em,
            telefono: tel,
            relacion: "otro",
          },
        ];
      }
    }

    // Parse estudiantes
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
      const ln = r.nombre_estudiante.trim();
      const lc = (r.curso ?? "").trim() || null;
      if (ln) estudiantes = [{ nombre: ln, curso: lc }];
    }

    try {
      // Buscar apoderado existente (por nombre exacto — pobre, pero es lo que hay
      // sin otra clave). Alternativa: por email del primer contacto.
      const primerEmail = contactos.find((c) => c.email)?.email ?? null;
      let apoderadoId: string | null = null;

      if (primerEmail) {
        const { data: exContacto } = await admin
          .from("contactos")
          .select("apoderado_id")
          .eq("email", primerEmail)
          .maybeSingle();
        if (exContacto) apoderadoId = exContacto.apoderado_id;
      }

      // Parse socio: acepta si/sí/yes/true/1 como true; no/false/0 como false
      const socioRaw = (r.socio ?? "").trim().toLowerCase();
      const socio =
        socioRaw === ""
          ? true
          : ["no", "false", "0", "n"].includes(socioRaw)
          ? false
          : true;

      if (apoderadoId) {
        await admin
          .from("apoderados")
          .update({ nombre, activo: true, socio })
          .eq("id", apoderadoId);
        result.actualizados++;
      } else {
        const { data, error } = await admin
          .from("apoderados")
          .insert({ nombre, activo: true, socio })
          .select("id")
          .single();
        if (error) throw error;
        apoderadoId = data.id;
        result.insertados++;
      }

      // Reemplazar contactos y estudiantes (para que reimportar sea consistente)
      if (contactos.length > 0) {
        await admin.from("contactos").delete().eq("apoderado_id", apoderadoId);
        const { error: eC } = await admin.from("contactos").insert(
          contactos.map((c) => ({
            apoderado_id: apoderadoId,
            nombre: c.nombre,
            email: c.email,
            telefono: c.telefono,
            relacion: c.relacion,
            activo: true,
          }))
        );
        if (eC) throw eC;
        result.contactosInsertados += contactos.length;
      }

      if (estudiantes.length > 0) {
        await admin.from("estudiantes").delete().eq("apoderado_id", apoderadoId);
        const { error: eE } = await admin.from("estudiantes").insert(
          estudiantes.map((e) => ({
            apoderado_id: apoderadoId,
            nombre: e.nombre,
            curso: e.curso,
            activo: true,
          }))
        );
        if (eE) throw eE;
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
