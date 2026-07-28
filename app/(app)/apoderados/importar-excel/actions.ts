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
  regalosRegistrados: number;
  errores: string[];
};

export type ImportOptions = {
  periodoNombre: string | null;
  montoDefault: number;
  generarPagos: boolean;
  // Regalo por incorporación (por familia socia): descripción y costos
  regaloEnabled: boolean;
  regaloDescripcionNormal: string; // ej. "Agenda normal"
  regaloValorNormal: number; // ej. 10000
  regaloDescripcionPrescolar: string; // ej. "Agenda preescolar"
  regaloValorPrescolar: number; // ej. 6000
};

const DEFAULT_OPTIONS: ImportOptions = {
  periodoNombre: "Cuota Anual 2026",
  montoDefault: 27000,
  generarPagos: true,
  regaloEnabled: true,
  regaloDescripcionNormal: "Agenda escolar",
  regaloValorNormal: 10000,
  regaloDescripcionPrescolar: "Agenda preescolar",
  regaloValorPrescolar: 6000,
};

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

function esPrescolar(curso: string | null | undefined): boolean {
  if (!curso) return false;
  const c = curso.trim().toUpperCase();
  return c.startsWith("PK") || c.startsWith("K-") || c === "K" || c.startsWith("MM");
}

// Normalizar nombre de header para búsqueda robusta
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n");
}

// Mapa: nombre normalizado → índice de columna
function buildColMap(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => {
    if (h) m.set(normalizeHeader(h), i);
  });
  return m;
}

function get(row: string[], cols: Map<string, number>, ...alternativas: string[]): string {
  for (const alt of alternativas) {
    const idx = cols.get(normalizeHeader(alt));
    if (idx !== undefined) {
      const v = s(row[idx]);
      if (v) return v;
    }
  }
  return "";
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

async function chunkedInFilter<T>(
  ids: string[],
  chunkSize: number,
  op: (chunk: string[]) => Promise<T | void>
) {
  for (let i = 0; i < ids.length; i += chunkSize) {
    await op(ids.slice(i, i + chunkSize));
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/** Import desde un archivo Excel subido por el usuario (FormData) */
export async function importarExcelFamilias(
  formData: FormData
): Promise<ExcelImportResult> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("No se recibió el archivo.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const opts = parseOptions(formData);
    return await runImportFromBytes(bytes, opts);
  } catch (err) {
    return failResult(err);
  }
}

/** Import desde Google Sheets vía URL pública */
export async function sincronizarDesdeGoogleSheets(
  formData: FormData
): Promise<ExcelImportResult> {
  try {
    const url = String(formData.get("sheetUrl") ?? "").trim();
    if (!url) throw new Error("Falta la URL del Google Sheets.");

    const id = extractSheetId(url);
    if (!id)
      throw new Error(
        "URL inválida. Debe ser tipo https://docs.google.com/spreadsheets/d/XXXXX/edit"
      );

    const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
    const resp = await fetch(exportUrl, { redirect: "follow" });
    if (!resp.ok) {
      throw new Error(
        `No se pudo descargar el sheet (${resp.status}). Asegúrate de que el link tenga permiso "cualquiera con el link puede ver".`
      );
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("spreadsheet") && !contentType.includes("octet-stream")) {
      throw new Error(
        `Google devolvió ${contentType}. El sheet probablemente no es público.`
      );
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const opts = parseOptions(formData);
    return await runImportFromBytes(bytes, opts);
  } catch (err) {
    return failResult(err);
  }
}

function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseOptions(formData: FormData): ImportOptions {
  const generarPagos = formData.get("generarPagos") === "1";
  return {
    periodoNombre: generarPagos
      ? String(formData.get("periodoNombre") ?? DEFAULT_OPTIONS.periodoNombre).trim() ||
        null
      : null,
    montoDefault: Number(formData.get("montoDefault") ?? DEFAULT_OPTIONS.montoDefault),
    generarPagos,
    regaloEnabled: formData.get("regaloEnabled") === "1",
    regaloDescripcionNormal:
      String(formData.get("regaloDescripcionNormal") ?? DEFAULT_OPTIONS.regaloDescripcionNormal).trim() ||
      DEFAULT_OPTIONS.regaloDescripcionNormal,
    regaloValorNormal: Number(
      formData.get("regaloValorNormal") ?? DEFAULT_OPTIONS.regaloValorNormal
    ),
    regaloDescripcionPrescolar:
      String(formData.get("regaloDescripcionPrescolar") ?? DEFAULT_OPTIONS.regaloDescripcionPrescolar).trim() ||
      DEFAULT_OPTIONS.regaloDescripcionPrescolar,
    regaloValorPrescolar: Number(
      formData.get("regaloValorPrescolar") ?? DEFAULT_OPTIONS.regaloValorPrescolar
    ),
  };
}

function failResult(err: unknown): ExcelImportResult {
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
    regalosRegistrados: 0,
    errores: [`CRÍTICO: ${msg}`],
  };
}

async function runImportFromBytes(
  bytes: Uint8Array,
  opts: ImportOptions
): Promise<ExcelImportResult> {
  const profile = await requireDirectiva();
  const admin = createSupabaseAdminClient();

  const wb = XLSX.read(bytes, { type: "array" });

  // Preferir hoja "Socios" (Google Sheets oficial). Fallback: Sheet1, primera.
  const wsName =
    wb.SheetNames.find((n) => normalizeHeader(n) === "socios") ??
    wb.SheetNames.find((n) => n === "Sheet1") ??
    wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });

  if (rows.length < 2) throw new Error(`La hoja "${wsName}" está vacía.`);

  const header = rows[0].map(s);
  const cols = buildColMap(header);

  // Validar columna 'familia' (obligatoria)
  if (!cols.has(normalizeHeader("familia"))) {
    throw new Error(
      `No encuentro la columna "familia" en la hoja "${wsName}". Headers: ${header.slice(0, 10).join(", ")}...`
    );
  }

  const result: ExcelImportResult = {
    familiasProcesadas: 0,
    familiasCreadas: 0,
    familiasActualizadas: 0,
    contactosCreados: 0,
    estudiantesCreados: 0,
    cuotasPeriodoId: null,
    cuotasCreadas: 0,
    cuotasPagadas: 0,
    regalosRegistrados: 0,
    errores: [],
  };

  // ==========================================================================
  // Fase 1: parsear filas y agrupar por familia
  // ==========================================================================

  type ContactoTmp = {
    nombre: string;
    email: string | null;
    telefono: string | null;
    relacion: ContactoRelacion;
    esApCuenta: boolean;
    esApAcademico: boolean;
  };

  type FamData = {
    nombre: string;
    socio: boolean;
    fechaInscripcion: string | null;
    valor: number;
    comprobante: string | null;
    tieneAgendaMarcada: boolean; // col 'agenda' con contenido
    contactos: Map<string, ContactoTmp>; // key: email o "no-email:relacion"
    estudiantes: { nombre: string; curso: string | null }[];
    apoderadoCuentaEmail: string | null;
    apoderadoAcademicoEmail: string | null;
    tienePrescolar: boolean;
  };

  const familias = new Map<string, FamData>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const nombre = get(row, cols, "familia");
    if (!nombre) continue;

    const socio = get(row, cols, "socio (SI/NO)", "socio").toUpperCase() === "SI";
    const fecha = parseFecha(get(row, cols, "fecha inscripcion", "fecha_inscripcion"));
    const valor = parseMonto(get(row, cols, "valor"));
    const comprobante = get(row, cols, "n° comprobante", "n comprobante", "comprobante") || null;
    const agendaMark = get(row, cols, "agenda");

    let fam = familias.get(nombre);
    if (!fam) {
      fam = {
        nombre,
        socio,
        fechaInscripcion: fecha,
        valor,
        comprobante,
        tieneAgendaMarcada: !!agendaMark,
        contactos: new Map(),
        estudiantes: [],
        apoderadoCuentaEmail: null,
        apoderadoAcademicoEmail: null,
        tienePrescolar: false,
      };
      familias.set(nombre, fam);
    } else {
      if (valor > fam.valor) fam.valor = valor;
      if (!fam.fechaInscripcion && fecha) fam.fechaInscripcion = fecha;
      if (!fam.comprobante && comprobante) fam.comprobante = comprobante;
      if (socio) fam.socio = true;
      if (agendaMark) fam.tieneAgendaMarcada = true;
    }

    // Estudiante de esta fila
    const alumnoNombre = buildNombre(
      get(row, cols, "[Alumnos]Nombres", "alumnosnombres", "nombres_alumno"),
      get(row, cols, "[Alumnos]Apellido_paterno", "alumnosapellido_paterno"),
      get(row, cols, "[Alumnos]Apellido_materno", "alumnosapellido_materno")
    );
    const alumnoCurso = get(row, cols, "[Alumnos]Curso", "alumnoscurso", "curso") || null;
    if (alumnoNombre) {
      fam.estudiantes.push({ nombre: alumnoNombre, curso: alumnoCurso });
      if (esPrescolar(alumnoCurso)) fam.tienePrescolar = true;
    }

    // Padre
    const padreNombre = buildNombre(
      get(row, cols, "[Padre]Nombres"),
      get(row, cols, "[Padre]Apellido_paterno"),
      get(row, cols, "[Padre]Apellido_materno")
    );
    const padreEmail = cleanEmail(get(row, cols, "[Padre]eMail", "[Padre]email"));
    const padreTel = get(row, cols, "[Padre]celular", "[Padre]telefono") || null;

    // Madre
    const madreNombre = buildNombre(
      get(row, cols, "[Madre]Nombres"),
      get(row, cols, "[Madre]Apellido_paterno"),
      get(row, cols, "[Madre]Apellido_materno")
    );
    const madreEmail = cleanEmail(get(row, cols, "[Madre]eMail", "[Madre]email"));
    const madreTel = get(row, cols, "[Madre]celular", "[Madre]telefono") || null;

    if (padreNombre) {
      const key = padreEmail ?? `noemail:padre`;
      if (!fam.contactos.has(key)) {
        fam.contactos.set(key, {
          nombre: padreNombre,
          email: padreEmail,
          telefono: padreTel,
          relacion: "padre",
          esApCuenta: false,
          esApAcademico: false,
        });
      }
    }
    if (madreNombre) {
      const key = madreEmail ?? `noemail:madre`;
      if (!fam.contactos.has(key)) {
        fam.contactos.set(key, {
          nombre: madreNombre,
          email: madreEmail,
          telefono: madreTel,
          relacion: "madre",
          esApCuenta: false,
          esApAcademico: false,
        });
      }
    }

    // Emails de apoderado de cuenta y académico (los usamos para marcar quién es cada uno)
    const apCuentaEmail = cleanEmail(
      get(row, cols, "[Apoderado de cuenta]eMail", "[Apoderado de cuenta]email")
    );
    const apAcadEmail = cleanEmail(
      get(row, cols, "[Apoderado academico]eMail", "[Apoderado academico]email", "[Apoderado académico]eMail")
    );
    if (apCuentaEmail && !fam.apoderadoCuentaEmail) fam.apoderadoCuentaEmail = apCuentaEmail;
    if (apAcadEmail && !fam.apoderadoAcademicoEmail) fam.apoderadoAcademicoEmail = apAcadEmail;
  }

  result.familiasProcesadas = familias.size;

  // Marcar es_apoderado_cuenta / es_apoderado_academico en los contactos por match de email
  for (const fam of familias.values()) {
    for (const c of fam.contactos.values()) {
      if (fam.apoderadoCuentaEmail && c.email === fam.apoderadoCuentaEmail) {
        c.esApCuenta = true;
      }
      if (fam.apoderadoAcademicoEmail && c.email === fam.apoderadoAcademicoEmail) {
        c.esApAcademico = true;
      }
    }
  }

  // ==========================================================================
  // Fase 2: DB
  // ==========================================================================

  // Período de cuota (crear o buscar)
  let periodoId: string | null = null;
  if (opts.generarPagos && opts.periodoNombre) {
    const { data: existente } = await admin
      .from("cuota_periodos")
      .select("id")
      .eq("nombre", opts.periodoNombre)
      .maybeSingle();
    if (existente) {
      periodoId = existente.id;
    } else {
      const { data: nuevo, error: eP } = await admin
        .from("cuota_periodos")
        .insert({
          nombre: opts.periodoNombre,
          monto: opts.montoDefault,
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

  // Cargar familias existentes
  const { data: existentes } = await admin
    .from("apoderados")
    .select("id, nombre");
  const existentesMap = new Map<string, string>();
  for (const e of existentes ?? []) existentesMap.set(e.nombre, e.id);

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

  // Bulk update socio para existentes (2 queries)
  const idsSiSocio = actualizar
    .filter((f) => f.socio)
    .map((f) => existentesMap.get(f.nombre)!)
    .filter(Boolean);
  const idsNoSocio = actualizar
    .filter((f) => !f.socio)
    .map((f) => existentesMap.get(f.nombre)!)
    .filter(Boolean);
  await chunkedInFilter(idsSiSocio, 150, async (chunk) => {
    const { error } = await admin
      .from("apoderados")
      .update({ activo: true, socio: true })
      .in("id", chunk);
    if (error) result.errores.push(`update socios: ${error.message}`);
  });
  await chunkedInFilter(idsNoSocio, 150, async (chunk) => {
    const { error } = await admin
      .from("apoderados")
      .update({ activo: true, socio: false })
      .in("id", chunk);
    if (error) result.errores.push(`update no-socios: ${error.message}`);
  });
  result.familiasActualizadas = actualizar.length;

  // Borrar contactos y estudiantes de todas las familias que vamos a re-cargar
  const familiaIds = familiasArr
    .map((f) => existentesMap.get(f.nombre))
    .filter(Boolean) as string[];

  if (familiaIds.length > 0) {
    await chunkedInFilter(familiaIds, 150, async (chunk) => {
      await admin.from("contactos").delete().in("apoderado_id", chunk);
    });
    await chunkedInFilter(familiaIds, 150, async (chunk) => {
      await admin.from("estudiantes").delete().in("apoderado_id", chunk);
    });
  }

  // Además: borrar contactos con emails que van a reutilizarse en otras familias
  // (por importaciones previas con nombres de familia distintos).
  const emailsNuevos = new Set<string>();
  for (const fam of familiasArr) {
    for (const c of fam.contactos.values()) {
      if (c.email) emailsNuevos.add(c.email);
    }
  }
  if (emailsNuevos.size > 0) {
    const emailsArr = Array.from(emailsNuevos);
    await chunkedInFilter(emailsArr, 150, async (chunk) => {
      await admin.from("contactos").delete().in("email", chunk);
    });
  }

  // Bulk insert contactos (dedupear emails globalmente)
  const contactosBulk: Record<string, unknown>[] = [];
  const emailsVistos = new Set<string>();
  for (const fam of familiasArr) {
    const fid = existentesMap.get(fam.nombre);
    if (!fid) continue;
    for (const c of fam.contactos.values()) {
      let email: string | null = c.email;
      if (email) {
        if (emailsVistos.has(email)) {
          email = null; // dedupe global; conservamos la fila sin email
        } else {
          emailsVistos.add(email);
        }
      }
      contactosBulk.push({
        apoderado_id: fid,
        nombre: c.nombre,
        email,
        telefono: c.telefono,
        relacion: c.relacion,
        es_apoderado_cuenta: c.esApCuenta,
        es_apoderado_academico: c.esApAcademico,
        activo: true,
      });
    }
  }
  await chunkedInsert(admin, "contactos", contactosBulk);
  result.contactosCreados = contactosBulk.length;

  // Bulk insert estudiantes
  const estudiantesBulk: Record<string, unknown>[] = [];
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

  // Cuotas + regalos
  if (periodoId) {
    await chunkedInFilter(familiaIds, 150, async (chunk) => {
      await admin
        .from("cuota_pagos")
        .delete()
        .eq("periodo_id", periodoId)
        .in("apoderado_id", chunk);
    });

    const pagosBulk = familiasArr
      .map<Record<string, unknown> | null>((fam) => {
        const fid = existentesMap.get(fam.nombre);
        if (!fid) return null;
        const montoPagado = fam.socio && fam.valor > 0 ? fam.valor : 0;
        const estado =
          fam.socio && montoPagado > 0
            ? "pagada"
            : fam.socio
            ? "pendiente"
            : "exenta";

        // Regalo si: es socio, la col 'agenda' venía marcada, y opciones activas
        let regaloDescripcion: string | null = null;
        let regaloValor = 0;
        if (opts.regaloEnabled && fam.socio && fam.tieneAgendaMarcada) {
          if (fam.tienePrescolar) {
            regaloDescripcion = opts.regaloDescripcionPrescolar;
            regaloValor = opts.regaloValorPrescolar;
          } else {
            regaloDescripcion = opts.regaloDescripcionNormal;
            regaloValor = opts.regaloValorNormal;
          }
        }

        return {
          periodo_id: periodoId,
          apoderado_id: fid,
          monto_pagado: montoPagado,
          estado,
          fecha_pago: montoPagado > 0 ? fam.fechaInscripcion : null,
          nota: fam.comprobante ? `Comprobante ${fam.comprobante}` : null,
          regalo_descripcion: regaloDescripcion,
          regalo_valor_costo: regaloValor,
        };
      })
      .filter((x): x is Record<string, unknown> => x !== null);

    const pagosCreados: {
      id: string;
      apoderado_id: string;
      monto: number;
      regalo_valor: number;
    }[] = [];
    for (let i = 0; i < pagosBulk.length; i += 500) {
      const chunk = pagosBulk.slice(i, i + 500);
      const { data, error } = await admin
        .from("cuota_pagos")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(chunk as any)
        .select("id, apoderado_id, monto_pagado, regalo_valor_costo");
      if (error) throw new Error("cuota_pagos: " + error.message);
      for (const d of data ?? []) {
        pagosCreados.push({
          id: d.id,
          apoderado_id: d.apoderado_id,
          monto: Number(d.monto_pagado),
          regalo_valor: Number(d.regalo_valor_costo ?? 0),
        });
      }
    }

    // Movimiento de ingreso por cada cuota pagada
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
          descripcion: `Cuota ${opts.periodoNombre} — ${fam?.nombre ?? ""}${
            fam?.comprobante ? ` (comp. ${fam.comprobante})` : ""
          }`,
          categoria_id: catCuota?.id ?? null,
          cuota_pago_id: p.id,
          created_by: profile.id,
        };
      });
    await chunkedInsert(admin, "movimientos", movimientosBulk);
    result.cuotasPagadas = movimientosBulk.length;
    result.regalosRegistrados = pagosCreados.filter((p) => p.regalo_valor > 0).length;
  }

  revalidatePath("/apoderados");
  revalidatePath("/cuotas");
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  return result;
}
