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

// Convierte fechas tipo "04/03/2026" (DD/MM/YYYY) a "2026-03-04" (ISO date)
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
  cols: { nombres: number; apP: number; apM: number; tel: number; email: number },
  relacion: ContactoRelacion
) {
  const nombre = buildNombre(s(row[cols.nombres]), s(row[cols.apP]), s(row[cols.apM]));
  if (!nombre) return null;
  return {
    nombre,
    email: cleanEmail(s(row[cols.email])),
    telefono: s(row[cols.tel]) || null,
    relacion,
  };
}

/**
 * Importa el Excel específico "familias 2026 Actualizado Abril.xlsx".
 * Estructura esperada de Sheet1 (30 columnas):
 *   0 familia, 1 Socio (SI/NO), 2 Fecha Inscripcion, 3 valor, 4 agenda, 5 N° Comprobante,
 *   6-9  Alumno: Nombres, Ap.paterno, Ap.materno, Curso
 *   10-14 Padre: Nombres, Ap.p, Ap.m, celular, eMail
 *   15-19 Madre: idem
 *   20-24 Apoderado de cuenta: idem
 *   25-29 Apoderado académico: idem
 *
 * - Agrupa filas por `familia` (una familia = varios estudiantes).
 * - Crea/actualiza apoderado (nombre familia, socio).
 * - Reemplaza contactos y estudiantes de esa familia con lo del Excel.
 * - Si `periodoNombre` no es null y hay filas socio con valor, crea el período
 *   de cuota y registra los pagos + movimiento de ingreso correspondiente.
 */
export async function importarExcelFamilias(
  fileBytes: ArrayBuffer,
  opciones: {
    periodoNombre: string | null;
    montoDefault: number; // usado si el Excel no tiene valor por familia
    generarPagos: boolean;
  }
): Promise<ExcelImportResult> {
  const profile = await requireDirectiva();
  const admin = createSupabaseAdminClient();

  const wb = XLSX.read(fileBytes, { type: "array" });
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

  // Saltar header
  const dataRows = rows.slice(1).filter((r) => s(r[0]));

  // Agrupar por nombre de familia
  type FamData = {
    nombre: string;
    socio: boolean;
    fechaInscripcion: string | null;
    valor: number;
    comprobante: string | null;
    contactos: Map<string, ReturnType<typeof extraerContacto>>;
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
      // Combinar: si ya tenía valor, mantener el mayor; fecha/comprobante si no existían
      if (valor > fam.valor) fam.valor = valor;
      if (!fam.fechaInscripcion && fecha) fam.fechaInscripcion = fecha;
      if (!fam.comprobante && comprobante) fam.comprobante = comprobante;
      if (socio) fam.socio = true;
    }

    // Estudiante de esta fila
    const alumnoNombre = buildNombre(s(row[6]), s(row[7]), s(row[8]));
    const alumnoCurso = s(row[9]) || null;
    if (alumnoNombre) {
      fam.estudiantes.push({ nombre: alumnoNombre, curso: alumnoCurso });
    }

    // Contactos (dedupear por relacion)
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

  // Crear período de cuota si corresponde
  let periodoId: string | null = null;
  if (opciones.generarPagos && opciones.periodoNombre) {
    // Buscar si ya existe
    const { data: existente } = await admin
      .from("cuota_periodos")
      .select("id")
      .eq("nombre", opciones.periodoNombre)
      .maybeSingle();

    if (existente) {
      periodoId = existente.id;
    } else {
      const { data: nuevo, error: eP } = await admin
        .from("cuota_periodos")
        .insert({
          nombre: opciones.periodoNombre,
          monto: opciones.montoDefault,
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

  // Buscar categoría "Cuota apoderado" para los movimientos
  const { data: catCuota } = await admin
    .from("categorias")
    .select("id")
    .eq("nombre", "Cuota apoderado")
    .maybeSingle();

  // Procesar cada familia
  for (const fam of familias.values()) {
    result.familiasProcesadas++;
    try {
      // Buscar familia existente: por nombre exacto
      const { data: ex } = await admin
        .from("apoderados")
        .select("id")
        .eq("nombre", fam.nombre)
        .maybeSingle();

      let apoderadoId: string;
      if (ex) {
        await admin
          .from("apoderados")
          .update({ activo: true, socio: fam.socio })
          .eq("id", ex.id);
        apoderadoId = ex.id;
        result.familiasActualizadas++;
      } else {
        const { data: nuevo, error: eA } = await admin
          .from("apoderados")
          .insert({ nombre: fam.nombre, activo: true, socio: fam.socio })
          .select("id")
          .single();
        if (eA) throw eA;
        apoderadoId = nuevo.id;
        result.familiasCreadas++;
      }

      // Reemplazar contactos
      await admin.from("contactos").delete().eq("apoderado_id", apoderadoId);
      const contactosArr = Array.from(fam.contactos.values()).filter(
        (c) => c !== null
      ) as NonNullable<ReturnType<typeof extraerContacto>>[];
      if (contactosArr.length > 0) {
        // Deduplicar emails duplicados dentro de la misma familia (padre=apCuenta)
        const vistos = new Set<string>();
        const insert = contactosArr
          .filter((c) => {
            if (!c.email) return true;
            if (vistos.has(c.email)) return false;
            vistos.add(c.email);
            return true;
          })
          .map((c) => ({
            apoderado_id: apoderadoId,
            nombre: c.nombre,
            email: c.email,
            telefono: c.telefono,
            relacion: c.relacion,
            activo: true,
          }));
        if (insert.length > 0) {
          const { error: eC } = await admin.from("contactos").insert(insert);
          if (eC) throw new Error(`${fam.nombre} - contactos: ${eC.message}`);
          result.contactosCreados += insert.length;
        }
      }

      // Reemplazar estudiantes
      await admin.from("estudiantes").delete().eq("apoderado_id", apoderadoId);
      if (fam.estudiantes.length > 0) {
        const insertEst = fam.estudiantes.map((e) => ({
          apoderado_id: apoderadoId,
          nombre: e.nombre,
          curso: e.curso,
          activo: true,
        }));
        const { error: eE } = await admin.from("estudiantes").insert(insertEst);
        if (eE) throw new Error(`${fam.nombre} - estudiantes: ${eE.message}`);
        result.estudiantesCreados += insertEst.length;
      }

      // Crear/actualizar pago de cuota
      if (periodoId) {
        const montoPagado = fam.socio && fam.valor > 0 ? fam.valor : 0;
        const estado =
          fam.socio && montoPagado > 0
            ? "pagada"
            : fam.socio
            ? "pendiente"
            : "exenta";

        // Upsert por (periodo, apoderado)
        await admin.from("cuota_pagos").delete().match({
          periodo_id: periodoId,
          apoderado_id: apoderadoId,
        });
        const { data: pago, error: ePago } = await admin
          .from("cuota_pagos")
          .insert({
            periodo_id: periodoId,
            apoderado_id: apoderadoId,
            monto_pagado: montoPagado,
            estado,
            fecha_pago: fam.fechaInscripcion,
            nota: fam.comprobante ? `Comprobante ${fam.comprobante}` : null,
          })
          .select("id")
          .single();
        if (ePago) throw new Error(`${fam.nombre} - cuota: ${ePago.message}`);

        // Movimiento en libro de caja
        if (montoPagado > 0 && pago) {
          await admin.from("movimientos").insert({
            fecha:
              fam.fechaInscripcion ??
              new Date().toISOString().slice(0, 10),
            tipo: "ingreso",
            monto: montoPagado,
            descripcion: `Cuota ${opciones.periodoNombre} — ${fam.nombre}${
              fam.comprobante ? ` (comp. ${fam.comprobante})` : ""
            }`,
            categoria_id: catCuota?.id ?? null,
            cuota_pago_id: pago.id,
            created_by: profile.id,
          });
          result.cuotasPagadas++;
        }
      }
    } catch (err) {
      result.errores.push(
        `${fam.nombre}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  revalidatePath("/apoderados");
  revalidatePath("/cuotas");
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  return result;
}
