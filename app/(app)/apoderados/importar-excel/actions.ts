"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContactoRelacion } from "@/lib/types";

export type ExcelImportResult = {
  familiasProcesadas: number;
  familiasCreadas: number;
  familiasActualizadas: number;
  contactosCreados: number;
  estudiantesCreados: number;
  cuotasPeriodoId: string | null;
  cuotasCreadas: number;
  cuotasPagadas: number;
  errores: string[];
};

type Row = string[];

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanEmail(v: string): string | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return null;
  return t;
}

function parseFecha(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseMonto(v: string): number {
  const clean = v.replace(/[^\d]/g, "");
  return clean ? Number(clean) : 0;
}

function buildNombre(...partes: string[]): string {
  return partes
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(" ")
    .trim();
}

function extraerContacto(
  row: Row,
  cols: {
    nombres: number;
    apP: number;
    apM: number;
    tel: number;
    email: number;
  },
  relacion: ContactoRelacion
) {
  const nombre = buildNombre(
    s(row[cols.nombres]),
    s(row[cols.apP]),
    s(row[cols.apM])
  );
  if (!nombre) return null;
  return {
    nombre,
    email: cleanEmail(s(row[cols.email])),
    telefono: s(row[cols.tel]) || null,
    relacion,
  };
}

async function chunkedInsert(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  chunkSize = 500
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from(table).insert(chunk as any);
    if (error)
      throw new Error(`insert ${table} (chunk ${i}): ${error.message}`);
  }
}

/**
 * Importa el Excel específico "familias 2026 Actualizado Abril.xlsx".
 * Optimizado con operaciones en lote para evitar timeout en Netlify.
 */
export async function importarExcelFamilias(
  formData: FormData
): Promise<ExcelImportResult> {
  try {
    return await runImport(formData);
  } catch (err) {
    // Envolver cualquier error crítico para que llegue al cliente
    // en vez de aparecer como "Server Components render error".
    const msg =
      err instanceof Error
        ? `${err.message}${err.stack ? "\n" + err.stack.split("\n").slice(0, 3).join("\n") : ""}`
        : String(err);
    return {
      familiasProcesadas: 0,
      familiasCreadas: 0,
      familiasActualizadas: 0,
      contactosCreados: 0,
      estudiantesCreados: 0,
      cuotasPeriodoId: null,
      cuotasCreadas: 0,
      cuotasPagadas: 0,
      errores: [`CRÍTICO: ${msg}`],
    };
  }
}

async function runImport(formData: FormData): Promise<ExcelImportResult> {
  const profile = await requireDirectiva();
  const admin = createSupabaseAdminClient();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("No se recibió el archivo.");
  }
  const generarPagos = formData.get("generarPagos") === "1";
  const periodoNombre = generarPagos
    ? String(formData.get("periodoNombre") ?? "").trim() || null
    : null;
  const montoDefault = Number(formData.get("montoDefault") ?? 0);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(bytes, { type: "array" });
  const wsName = wb.SheetNames.includes("Sheet1")
    ? "Sheet1"
    : wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });

  const result: ExcelImportResult = {
    familiasProcesadas: 0,
    familiasCreadas: 0,
    familiasActualizadas: 0,
    contactosCreados: 0,
    estudiantesCreados: 0,
    cuotasPeriodoId: null,
    cuotasCreadas: 0,
    cuotasPagadas: 0,
    errores: [],
  };

  const dataRows = rows.slice(1).filter((r) => s(r[0]));

  // Agrupar por familia
  type ContactoTmp = NonNullable<ReturnType<typeof extraerContacto>>;
  type FamData = {
    nombre: string;
    socio: boolean;
    fechaInscripcion: string | null;
    valor: number;
    comprobante: string | null;
    contactos: Map<ContactoRelacion, ContactoTmp>;
    estudiantes: { nombre: string; curso: string | null }[];
  };

  const familias = new Map<string, FamData>();

  for (const row of dataRows) {
    const nombre = s(row[0]);
    const socio = s(row[1]).toUpperCase() === "SI";
    const fecha = parseFecha(s(row[2]));
    const valor = parseMonto(s(row[3]));
    const comprobante = s(row[5]) || null;

    let fam = familias.get(nombre);
    if (!fam) {
      fam = {
        nombre,
        socio,
        fechaInscripcion: fecha,
        valor,
        comprobante,
        contactos: new Map(),
        estudiantes: [],
      };
      familias.set(nombre, fam);
    } else {
      if (valor > fam.valor) fam.valor = valor;
      if (!fam.fechaInscripcion && fecha) fam.fechaInscripcion = fecha;
      if (!fam.comprobante && comprobante) fam.comprobante = comprobante;
      if (socio) fam.socio = true;
    }

    const alumnoNombre = buildNombre(s(row[6]), s(row[7]), s(row[8]));
    const alumnoCurso = s(row[9]) || null;
    if (alumnoNombre) {
      fam.estudiantes.push({ nombre: alumnoNombre, curso: alumnoCurso });
    }

    const padre = extraerContacto(
      row,
      { nombres: 10, apP: 11, apM: 12, tel: 13, email: 14 },
      "padre"
    );
    const madre = extraerContacto(
      row,
      { nombres: 15, apP: 16, apM: 17, tel: 18, email: 19 },
      "madre"
    );
    const apCuenta = extraerContacto(
      row,
      { nombres: 20, apP: 21, apM: 22, tel: 23, email: 24 },
      "apoderado_cuenta"
    );
    const apAcad = extraerContacto(
      row,
      { nombres: 25, apP: 26, apM: 27, tel: 28, email: 29 },
      "apoderado_academico"
    );

    for (const c of [padre, madre, apCuenta, apAcad]) {
      if (c && !fam.contactos.has(c.relacion)) {
        fam.contactos.set(c.relacion, c);
      }
    }
  }

  result.familiasProcesadas = familias.size;

  // === 1. Crear período de cuota si corresponde ===
  let periodoId: string | null = null;
  if (generarPagos && periodoNombre) {
    const { data: existente } = await admin
      .from("cuota_periodos")
      .select("id")
      .eq("nombre", periodoNombre)
      .maybeSingle();
    if (existente) {
      periodoId = existente.id;
    } else {
      const { data: nuevo, error: eP } = await admin
        .from("cuota_periodos")
        .insert({
          nombre: periodoNombre,
          monto: montoDefault,
          activa: true,
        })
        .select("id")
        .single();
      if (eP) throw new Error("Error creando período: " + eP.message);
      periodoId = nuevo.id;
      result.cuotasCreadas = 1;
    }
    result.cuotasPeriodoId = periodoId;
  }

  // === 2. Cargar familias existentes ===
  const { data: existentes } = await admin
    .from("apoderados")
    .select("id, nombre");
  const existentesMap = new Map<string, string>();
  for (const e of existentes ?? []) existentesMap.set(e.nombre, e.id);

  // === 3. Insertar/actualizar familias en lote ===
  const familiasArr = Array.from(familias.values());
  const nuevas = familiasArr.filter((f) => !existentesMap.has(f.nombre));
  const actualizar = familiasArr.filter((f) => existentesMap.has(f.nombre));

  if (nuevas.length > 0) {
    const { data: creadas, error: eIns } = await admin
      .from("apoderados")
      .insert(
        nuevas.map((f) => ({
          nombre: f.nombre,
          activo: true,
          socio: f.socio,
        }))
      )
      .select("id, nombre");
    if (eIns) throw new Error("Insertando familias: " + eIns.message);
    for (const c of creadas ?? []) existentesMap.set(c.nombre, c.id);
    result.familiasCreadas = nuevas.length;
  }

  // Actualizar existentes (una llamada por familia — se puede optimizar más)
  for (const f of actualizar) {
    const { error: eU } = await admin
      .from("apoderados")
      .update({ activo: true, socio: f.socio })
      .eq("id", existentesMap.get(f.nombre)!);
    if (eU) result.errores.push(`${f.nombre} update: ${eU.message}`);
  }
  result.familiasActualizadas = actualizar.length;

  // === 4. Borrar contactos y estudiantes de TODAS las familias que vamos a re-cargar ===
  const familiaIds = familiasArr
    .map((f) => existentesMap.get(f.nombre))
    .filter(Boolean) as string[];

  if (familiaIds.length > 0) {
    await admin.from("contactos").delete().in("apoderado_id", familiaIds);
    await admin.from("estudiantes").delete().in("apoderado_id", familiaIds);
  }

  // === 5. Bulk insert contactos ===
  const contactosBulk: {
    apoderado_id: string;
    nombre: string;
    email: string | null;
    telefono: string | null;
    relacion: ContactoRelacion;
    activo: boolean;
  }[] = [];
  const emailsVistos = new Set<string>();
  for (const fam of familiasArr) {
    const fid = existentesMap.get(fam.nombre);
    if (!fid) continue;
    for (const c of fam.contactos.values()) {
      // Deduplicar emails globalmente (contactos.email tiene unique index)
      if (c.email) {
        if (emailsVistos.has(c.email)) {
          contactosBulk.push({
            apoderado_id: fid,
            nombre: c.nombre,
            email: null,
            telefono: c.telefono,
            relacion: c.relacion,
            activo: true,
          });
          continue;
        }
        emailsVistos.add(c.email);
      }
      contactosBulk.push({
        apoderado_id: fid,
        nombre: c.nombre,
        email: c.email,
        telefono: c.telefono,
        relacion: c.relacion,
        activo: true,
      });
    }
  }
  await chunkedInsert(admin, "contactos", contactosBulk);
  result.contactosCreados = contactosBulk.length;

  // === 6. Bulk insert estudiantes ===
  const estudiantesBulk: {
    apoderado_id: string;
    nombre: string;
    curso: string | null;
    activo: boolean;
  }[] = [];
  for (const fam of familiasArr) {
    const fid = existentesMap.get(fam.nombre);
    if (!fid) continue;
    for (const e of fam.estudiantes) {
      estudiantesBulk.push({
        apoderado_id: fid,
        nombre: e.nombre,
        curso: e.curso,
        activo: true,
      });
    }
  }
  await chunkedInsert(admin, "estudiantes", estudiantesBulk);
  result.estudiantesCreados = estudiantesBulk.length;

  // === 7. Cuotas ===
  if (periodoId) {
    // Borrar cuota_pagos existentes de este período para estas familias
    await admin
      .from("cuota_pagos")
      .delete()
      .eq("periodo_id", periodoId)
      .in("apoderado_id", familiaIds);

    // Bulk insert cuota_pagos
    const pagosBulk = familiasArr
      .map((fam) => {
        const fid = existentesMap.get(fam.nombre);
        if (!fid) return null;
        const montoPagado = fam.socio && fam.valor > 0 ? fam.valor : 0;
        const estado =
          fam.socio && montoPagado > 0
            ? "pagada"
            : fam.socio
            ? "pendiente"
            : "exenta";
        return {
          periodo_id: periodoId,
          apoderado_id: fid,
          monto_pagado: montoPagado,
          estado,
          fecha_pago: montoPagado > 0 ? fam.fechaInscripcion : null,
          nota: fam.comprobante ? `Comprobante ${fam.comprobante}` : null,
        };
      })
      .filter(Boolean) as {
      periodo_id: string;
      apoderado_id: string;
      monto_pagado: number;
      estado: string;
      fecha_pago: string | null;
      nota: string | null;
    }[];

    // Insert cuota_pagos y capturar IDs para el movimiento
    const pagosCreados: { id: string; apoderado_id: string; monto: number }[] =
      [];
    for (let i = 0; i < pagosBulk.length; i += 500) {
      const chunk = pagosBulk.slice(i, i + 500);
      const { data, error } = await admin
        .from("cuota_pagos")
        .insert(chunk)
        .select("id, apoderado_id, monto_pagado");
      if (error) throw new Error("cuota_pagos: " + error.message);
      for (const d of data ?? []) {
        pagosCreados.push({
          id: d.id,
          apoderado_id: d.apoderado_id,
          monto: Number(d.monto_pagado),
        });
      }
    }

    // Movimientos (solo para pagos > 0)
    const { data: catCuota } = await admin
      .from("categorias")
      .select("id")
      .eq("nombre", "Cuota apoderado")
      .maybeSingle();

    const famById = new Map<string, FamData>();
    for (const fam of familiasArr) {
      const fid = existentesMap.get(fam.nombre);
      if (fid) famById.set(fid, fam);
    }

    const movimientosBulk = pagosCreados
      .filter((p) => p.monto > 0)
      .map((p) => {
        const fam = famById.get(p.apoderado_id);
        return {
          fecha:
            fam?.fechaInscripcion ?? new Date().toISOString().slice(0, 10),
          tipo: "ingreso",
          monto: p.monto,
          descripcion: `Cuota ${periodoNombre} — ${fam?.nombre ?? ""}${
            fam?.comprobante ? ` (comp. ${fam.comprobante})` : ""
          }`,
          categoria_id: catCuota?.id ?? null,
          cuota_pago_id: p.id,
          created_by: profile.id,
        };
      });

    await chunkedInsert(admin, "movimientos", movimientosBulk);
    result.cuotasPagadas = movimientosBulk.length;
  }

  revalidatePath("/apoderados");
  revalidatePath("/cuotas");
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  return result;
}
