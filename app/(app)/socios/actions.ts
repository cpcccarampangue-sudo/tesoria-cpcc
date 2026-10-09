"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";
import { precioVigente } from "@/lib/socios/precio";
import { obtenerOGenerarQrFamilia } from "@/lib/socios/qr-familia";
import { determinarTipoCorreo } from "@/lib/socios/tipo-correo";
import { chileLocalToUtc } from "@/lib/tz-chile";

// Valida y normaliza un Payment Link de SumUp. Debe ser https y dominio
// pay.sumup.com. Vacio -> null. Lanza si invalido.
function validarSumupLink(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  if (v === "") return null;
  if (v.length > 2000) throw new Error("El link SumUp es demasiado largo.");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("El link SumUp debe ser una URL valida.");
  }
  if (u.protocol !== "https:") {
    throw new Error("El link SumUp debe comenzar con https://.");
  }
  if (!/\.sumup\.com$/i.test(u.hostname) && u.hostname !== "sumup.com") {
    throw new Error(
      "El link SumUp debe apuntar a pay.sumup.com (dominio sumup.com)."
    );
  }
  return v;
}
import type { Apoderado, Contacto, Estudiante, SocioConfig } from "@/lib/types";
import type {
  FamiliaCandidataAdmin,
  ResultadoBusquedaAdmin,
} from "./tipos";

// Busqueda flexible de familias para el admin (NO publica). A diferencia
// de la busqueda publica de /incorporacion, aqui aceptamos email, nombre
// del apoderado, nombre del alumno o RUT, y devolvemos datos completos.
// La proteccion es requireDirectiva(): solo usuarios autenticados con
// rol directiva pueden ejecutarla.
export async function buscarFamiliasAdmin(
  consulta: string
): Promise<ResultadoBusquedaAdmin> {
  await requireDirectiva();
  const trimmed = consulta.trim();
  if (!trimmed || trimmed.length < 2) {
    return { familias: [], hayMas: false };
  }

  const supabase = await createSupabaseServerClient();
  const MAX = 10;
  const q = trimmed.toLowerCase();
  const idSet = new Set<string>();

  // 1) match por email, nombre o RUT del contacto
  const { data: cData } = await supabase
    .from("contactos")
    .select("apoderado_id, email, nombre, rut")
    .or(`email.ilike.%${q}%,nombre.ilike.%${q}%,rut.ilike.%${q}%`)
    .limit(MAX + 1);
  for (const c of (cData ?? []) as Array<{ apoderado_id: string }>) {
    if (c.apoderado_id) idSet.add(c.apoderado_id);
  }

  // 2) match por nombre del apoderado
  const { data: aData } = await supabase
    .from("apoderados")
    .select("id, nombre")
    .ilike("nombre", `%${q}%`)
    .limit(MAX + 1);
  for (const a of (aData ?? []) as Array<{ id: string }>) {
    idSet.add(a.id);
  }

  // 3) match por nombre de alumno activo
  const { data: eData } = await supabase
    .from("estudiantes")
    .select("apoderado_id, nombre")
    .ilike("nombre", `%${q}%`)
    .eq("activo", true)
    .limit(MAX + 1);
  for (const e of (eData ?? []) as Array<{ apoderado_id: string }>) {
    if (e.apoderado_id) idSet.add(e.apoderado_id);
  }

  if (idSet.size === 0) {
    return { familias: [], hayMas: false };
  }

  const ids = Array.from(idSet).slice(0, MAX);
  const hayMas = idSet.size > MAX;

  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("periodo_anio")
    .eq("id", 1)
    .maybeSingle();
  const periodoVigente =
    (cfgData as { periodo_anio: number } | null)?.periodo_anio ??
    new Date().getFullYear();

  const [
    { data: apoderadosData },
    { data: contactosData },
    { data: estudiantesData },
    { data: solData },
  ] = await Promise.all([
    supabase.from("apoderados").select("*").in("id", ids),
    supabase.from("contactos").select("*").in("apoderado_id", ids),
    supabase
      .from("estudiantes")
      .select("*")
      .in("apoderado_id", ids)
      .eq("activo", true),
    supabase
      .from("socio_solicitudes")
      .select("apoderado_id, qr_token, estado")
      .in("apoderado_id", ids)
      .eq("periodo_anio", periodoVigente)
      .in("estado", ["pagada", "enviada"]),
  ]);

  const apoderadosMap = new Map<string, Apoderado>();
  for (const a of (apoderadosData ?? []) as Apoderado[]) {
    apoderadosMap.set(a.id, a);
  }
  const contactosMap = new Map<string, Contacto[]>();
  for (const c of (contactosData ?? []) as Contacto[]) {
    const arr = contactosMap.get(c.apoderado_id) ?? [];
    arr.push(c);
    contactosMap.set(c.apoderado_id, arr);
  }
  const estudiantesMap = new Map<string, Estudiante[]>();
  for (const e of (estudiantesData ?? []) as Estudiante[]) {
    const arr = estudiantesMap.get(e.apoderado_id) ?? [];
    arr.push(e);
    estudiantesMap.set(e.apoderado_id, arr);
  }
  const yaSocioMap = new Map<string, string>();
  for (const s of (solData ?? []) as {
    apoderado_id: string;
    qr_token: string;
  }[]) {
    yaSocioMap.set(s.apoderado_id, s.qr_token);
  }

  const familias: FamiliaCandidataAdmin[] = [];
  for (const id of ids) {
    const a = apoderadosMap.get(id);
    if (!a) continue;
    familias.push({
      apoderado: a,
      contactos: (contactosMap.get(id) ?? []).sort((x, y) =>
        (x.nombre ?? "").localeCompare(y.nombre ?? "")
      ),
      estudiantes: (estudiantesMap.get(id) ?? []).sort((x, y) =>
        x.nombre.localeCompare(y.nombre)
      ),
      yaSocioToken: yaSocioMap.get(id) ?? null,
    });
  }

  return { familias, hayMas };
}

// Config
export type ActualizarConfigInput = {
  periodo_anio: number;
  periodo_inicio: string | null; // "YYYY-MM-DD"
  periodo_fin: string | null;
  monto_cuota_normal: number;
  // Promo opcional: los 3 vienen juntos o los 3 null.
  monto_cuota_promocional: number | null;
  promocion_inicio: string | null; // "YYYY-MM-DDTHH:mm[:ss]" en hora de Chile
  promocion_fin: string | null;
  sumup_link_promo: string | null;
  sumup_link_normal: string | null;
  cuenta_sumup_id: string | null;
  categoria_cuota_id: string | null;
  mensaje_bienvenida: string | null;
  // Correos socios (migracion 031). Null => fallback a texto default.
  cpcc_instagram_url: string | null;
  cpcc_whatsapp_url: string | null;
  cpcc_convenios_url: string | null;
  correo_bienvenida_asunto: string | null;
  correo_bienvenida_cuerpo: string | null;
  correo_renovacion_asunto: string | null;
  correo_renovacion_cuerpo: string | null;
};

// Valida y normaliza una URL opcional para correos socios. Solo https.
// Vacio -> null. Lanza si invalida.
function validarUrlHttps(input: string | null | undefined, campo: string): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  if (v === "") return null;
  if (v.length > 2000) throw new Error(`${campo}: URL demasiado larga.`);
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${campo}: URL inválida.`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`${campo}: debe comenzar con https://.`);
  }
  return v;
}

function validarAsunto(input: string | null | undefined, campo: string): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  if (v === "") return null;
  if (v.length > 200) throw new Error(`${campo}: máximo 200 caracteres.`);
  if (/\n/.test(v)) throw new Error(`${campo}: no debe contener saltos de línea.`);
  return v;
}

function validarCuerpo(input: string | null | undefined, campo: string): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  if (v === "") return null;
  if (v.length > 5000) throw new Error(`${campo}: máximo 5000 caracteres.`);
  return v;
}

export async function actualizarSocioConfig(input: ActualizarConfigInput) {
  await requireDirectiva();
  // Validacion: si vienen las dos fechas, inicio debe ser antes que fin.
  if (input.periodo_inicio && input.periodo_fin) {
    if (input.periodo_inicio > input.periodo_fin) {
      throw new Error(
        "La fecha de inicio del periodo debe ser anterior a la fecha de fin."
      );
    }
  }
  if (!Number.isInteger(input.monto_cuota_normal) || input.monto_cuota_normal <= 0) {
    throw new Error("El precio normal debe ser un entero positivo.");
  }
  // Promo coherente: o los 3 o ninguno.
  const promoCampos = [
    input.monto_cuota_promocional,
    input.promocion_inicio,
    input.promocion_fin,
  ];
  const promoLlenos = promoCampos.filter((v) => v !== null && v !== "").length;
  if (promoLlenos !== 0 && promoLlenos !== 3) {
    throw new Error(
      "Si configuras una promoción, debes definir precio promocional + inicio + fin (o dejar los tres en blanco)."
    );
  }
  let promoInicioUtc: string | null = null;
  let promoFinUtc: string | null = null;
  if (promoLlenos === 3) {
    if (
      !Number.isInteger(input.monto_cuota_promocional!) ||
      input.monto_cuota_promocional! <= 0
    ) {
      throw new Error("El precio promocional debe ser un entero positivo.");
    }
    if (input.monto_cuota_promocional! > input.monto_cuota_normal) {
      throw new Error(
        "El precio promocional no puede ser mayor que el precio normal."
      );
    }
    // Interpretar strings locales como hora de Chile y pasarlos a UTC.
    const iniLocal = chileLocalToUtc(input.promocion_inicio);
    const finLocal = chileLocalToUtc(input.promocion_fin);
    if (!iniLocal || !finLocal) {
      throw new Error("Fechas de promoción inválidas.");
    }
    if (finLocal <= iniLocal) {
      throw new Error(
        "La fecha de inicio de la promoción debe ser anterior a la fecha de fin."
      );
    }
    promoInicioUtc = iniLocal.toISOString();
    promoFinUtc = finLocal.toISOString();
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("socio_config")
    .update({
      periodo_anio: input.periodo_anio,
      periodo_inicio: input.periodo_inicio,
      periodo_fin: input.periodo_fin,
      monto_cuota_normal: input.monto_cuota_normal,
      monto_cuota_promocional:
        promoLlenos === 3 ? input.monto_cuota_promocional : null,
      promocion_inicio: promoInicioUtc,
      promocion_fin: promoFinUtc,
      sumup_link_promo: validarSumupLink(input.sumup_link_promo),
      sumup_link_normal: validarSumupLink(input.sumup_link_normal),
      cuenta_sumup_id: input.cuenta_sumup_id,
      categoria_cuota_id: input.categoria_cuota_id,
      mensaje_bienvenida: input.mensaje_bienvenida,
      cpcc_instagram_url: validarUrlHttps(input.cpcc_instagram_url, "URL Instagram"),
      cpcc_whatsapp_url: validarUrlHttps(input.cpcc_whatsapp_url, "URL WhatsApp"),
      cpcc_convenios_url: validarUrlHttps(input.cpcc_convenios_url, "URL Convenios"),
      correo_bienvenida_asunto: validarAsunto(input.correo_bienvenida_asunto, "Asunto bienvenida"),
      correo_bienvenida_cuerpo: validarCuerpo(input.correo_bienvenida_cuerpo, "Cuerpo bienvenida"),
      correo_renovacion_asunto: validarAsunto(input.correo_renovacion_asunto, "Asunto renovación"),
      correo_renovacion_cuerpo: validarCuerpo(input.correo_renovacion_cuerpo, "Cuerpo renovación"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath("/socios/config");
  revalidatePath("/incorporacion");
  revalidatePath("/socios/nuevo");
}

// Preview del correo socio para /socios/config. Admite overrides del
// formulario (sin guardar) para mostrar como quedaria antes de aplicar.
// Devuelve subject + html con datos ficticios (Familia Gonzalez).
export type PreviewOverrides = {
  cpcc_instagram_url?: string | null;
  cpcc_whatsapp_url?: string | null;
  cpcc_convenios_url?: string | null;
  correo_bienvenida_asunto?: string | null;
  correo_bienvenida_cuerpo?: string | null;
  correo_renovacion_asunto?: string | null;
  correo_renovacion_cuerpo?: string | null;
};

export async function previewCorreoSocio(
  tipo: "bienvenida" | "renovacion",
  overrides: PreviewOverrides = {}
): Promise<{ subject: string; html: string }> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const config = cfgData as import("@/lib/types").SocioConfig | null;
  const configConOverrides = config
    ? ({
        ...config,
        cpcc_instagram_url:
          overrides.cpcc_instagram_url !== undefined
            ? overrides.cpcc_instagram_url || null
            : config.cpcc_instagram_url,
        cpcc_whatsapp_url:
          overrides.cpcc_whatsapp_url !== undefined
            ? overrides.cpcc_whatsapp_url || null
            : config.cpcc_whatsapp_url,
        cpcc_convenios_url:
          overrides.cpcc_convenios_url !== undefined
            ? overrides.cpcc_convenios_url || null
            : config.cpcc_convenios_url,
        correo_bienvenida_asunto:
          overrides.correo_bienvenida_asunto !== undefined
            ? overrides.correo_bienvenida_asunto || null
            : config.correo_bienvenida_asunto,
        correo_bienvenida_cuerpo:
          overrides.correo_bienvenida_cuerpo !== undefined
            ? overrides.correo_bienvenida_cuerpo || null
            : config.correo_bienvenida_cuerpo,
        correo_renovacion_asunto:
          overrides.correo_renovacion_asunto !== undefined
            ? overrides.correo_renovacion_asunto || null
            : config.correo_renovacion_asunto,
        correo_renovacion_cuerpo:
          overrides.correo_renovacion_cuerpo !== undefined
            ? overrides.correo_renovacion_cuerpo || null
            : config.correo_renovacion_cuerpo,
      } as import("@/lib/types").SocioConfig)
    : null;

  // Datos ficticios: Familia Gonzalez. Monto segun precioVigente.
  const periodo = config?.periodo_anio ?? new Date().getFullYear();
  const monto = config ? precioVigente(config) : 20000;

  // QR data URL dummy (1x1 pixel transparente) — no renderiza un QR real
  // pero mantiene el layout del correo.
  const qrDataUrl =
    "data:image/svg+xml;base64," +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#f1f5f9"/><text x="120" y="130" text-anchor="middle" font-family="monospace" font-size="14" fill="#64748b">QR DE EJEMPLO</text></svg>'
    ).toString("base64");

  const fakeSolicitud: import("@/lib/types").SocioSolicitud = {
    id: "00000000-0000-0000-0000-000000000000",
    qr_token: "00000000-0000-0000-0000-000000000000",
    periodo_anio: periodo,
    apoderado_id: null,
    apoderado_nombre: "Familia González",
    apoderado_email: "familia.gonzalez@example.cl",
    apoderado_rut: null,
    apoderado_telefono: null,
    alumno_nombre: "Juan González",
    curso: "5° Básico A",
    monto_cuota: monto,
    sumup_checkout_id: null,
    sumup_transaction_id: null,
    sumup_transaction_code: null,
    movimiento_id: null,
    pagada_en: new Date().toISOString(),
    email_enviado_en: null,
    email_reenvios: 0,
    estado: "pagada",
    notas_internas: null,
    procesada_por: null,
    tipo_correo: tipo,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { armarCorreoSocioHtml } = await import("@/lib/email/socio-template");
  // Preview visual en iframe sandbox: data URL funciona bien aqui porque
  // no pasa por SMTP (en SMTP real se usa cid, ver enviar-qr.ts).
  // saludoNombre "Juan" es el primer nombre ficticio para que el preview
  // muestre "Hola Juan," en el saludo.
  return armarCorreoSocioHtml({
    solicitud: fakeSolicitud,
    qrSrc: qrDataUrl,
    qrTokenPublico: fakeSolicitud.qr_token,
    tipo,
    config: configConOverrides,
    saludoNombre: "Juan",
  });
}

// Crea una solicitud de socio + registra el pago en el mismo paso, sin
// pasar por /incorporacion. Util cuando la tesorera recibe un pago en
// efectivo o transferencia directa en una reunion.
export type CrearSocioManualInput = {
  apoderado_id: string;
  apoderado_email: string;
  apoderado_telefono?: string;
  estudiante_ids: string[];
  cuenta_id: string;
  fecha: string; // YYYY-MM-DD
  metodo: "efectivo" | "transferencia" | "cheque" | "otro";
  nota?: string;
  enviarQr?: boolean;
};

const EMAIL_RE_SIMPLE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function crearSocioConPagoManual(
  input: CrearSocioManualInput
): Promise<string> {
  const profile = await requireDirectiva();
  const email = input.apoderado_email.trim().toLowerCase();
  if (!EMAIL_RE_SIMPLE.test(email)) {
    throw new Error("El correo electrónico no es válido.");
  }
  if (!input.cuenta_id) throw new Error("Debes elegir una cuenta.");
  if (!input.estudiante_ids || input.estudiante_ids.length === 0) {
    throw new Error("Selecciona al menos un hijo.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: apoderadoData } = await supabase
    .from("apoderados")
    .select("id, nombre")
    .eq("id", input.apoderado_id)
    .maybeSingle();
  const apoderado = apoderadoData as { id: string; nombre: string } | null;
  if (!apoderado) throw new Error("Familia no encontrada.");

  const { data: estudiantesData } = await supabase
    .from("estudiantes")
    .select("id, nombre, curso")
    .eq("apoderado_id", input.apoderado_id)
    .in("id", input.estudiante_ids);
  const estudiantes =
    (estudiantesData as
      | { id: string; nombre: string; curso: string | null }[]
      | null) ?? [];
  if (estudiantes.length === 0) {
    throw new Error("Los hijos seleccionados no corresponden a esta familia.");
  }

  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const config = cfgData as SocioConfig | null;
  if (!config) throw new Error("Sistema de socios no está configurado.");
  // Precio decidido en servidor segun promo vigente ahora.
  const monto = precioVigente(config);

  // Verificar duplicado: misma familia + periodo + estado activo
  const { data: existenteData } = await supabase
    .from("socio_solicitudes")
    .select("id, estado")
    .eq("periodo_anio", config.periodo_anio)
    .eq("apoderado_id", input.apoderado_id)
    .in("estado", ["pendiente_pago", "pagada", "enviada"])
    .maybeSingle();
  if (existenteData) {
    throw new Error(
      `Esta familia ya tiene una solicitud activa del año ${config.periodo_anio}. Revisa en la lista de socios.`
    );
  }

  const alumnoRepr = estudiantes.map((e) => e.nombre).join(", ");
  const cursoRepr = estudiantes.map((e) => e.curso ?? "—").join(", ");

  // 1. Crear movimiento ingreso
  const metodoLabel: Record<string, string> = {
    efectivo: "Efectivo",
    transferencia: "Transferencia bancaria",
    cheque: "Cheque",
    otro: "Otro",
  };
  const descripcion = `Cuota socio CdP ${config.periodo_anio} — ${apoderado.nombre} (${metodoLabel[input.metodo]})`;

  const { data: movData, error: movErr } = await supabase
    .from("movimientos")
    .insert({
      fecha: input.fecha,
      tipo: "ingreso",
      monto,
      descripcion,
      categoria_id: config.categoria_cuota_id,
      cuenta_id: input.cuenta_id,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (movErr || !movData) {
    throw new Error(
      `No se pudo crear el movimiento: ${movErr?.message ?? "sin detalle"}`
    );
  }

  // 2. Crear solicitud ya pagada + linkeada al movimiento
  const notaInterna = [
    `Creada manualmente desde el admin por la directiva.`,
    `Pago ${metodoLabel[input.metodo]} registrado el ${new Date().toLocaleDateString("es-CL")}.`,
    input.nota?.trim() ? `Nota: ${input.nota.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Snapshot inmutable del tipo de correo (ANTES de cualquier UPDATE a
  // apoderados.socio_periodo que pueda ocurrir despues).
  const tipoCorreo = await determinarTipoCorreo(
    supabase,
    input.apoderado_id,
    config.periodo_anio
  );
  const { data: solData, error: solErr } = await supabase
    .from("socio_solicitudes")
    .insert({
      periodo_anio: config.periodo_anio,
      apoderado_id: input.apoderado_id,
      apoderado_nombre: apoderado.nombre,
      apoderado_email: email,
      apoderado_telefono: input.apoderado_telefono?.trim() || null,
      alumno_nombre: alumnoRepr,
      curso: cursoRepr,
      monto_cuota: monto,
      estado: "pagada",
      pagada_en: new Date(input.fecha).toISOString(),
      movimiento_id: movData.id,
      notas_internas: notaInterna,
      procesada_por: profile.id,
      tipo_correo: tipoCorreo,
    })
    .select("id")
    .single();
  if (solErr || !solData) {
    throw new Error(
      `No se pudo crear la solicitud: ${solErr?.message ?? "sin detalle"}`
    );
  }

  // 3. QR permanente por familia: asegurar apoderados.qr_token
  //    (reutiliza si ya tenia, genera si no). Es el QR que ira al correo.
  try {
    await obtenerOGenerarQrFamilia(supabase, input.apoderado_id);
  } catch (err) {
    console.error(
      "Error asignando qr_token al apoderado tras alta manual:",
      err instanceof Error ? err.message : err
    );
  }

  // 4. Enviar QR si se solicito
  if (input.enviarQr) {
    try {
      await enviarCorreoQrSocio(solData.id);
    } catch (err) {
      console.error("Error enviando QR tras creacion manual:", err);
      // No fallamos: la solicitud ya fue creada, se puede reenviar manual.
    }
  }

  revalidatePath("/socios");
  revalidatePath("/movimientos");
  revalidatePath("/apoderados");
  return solData.id as string;
}

export type RegistrarPagoManualInput = {
  solicitud_id: string;
  cuenta_id: string;
  fecha: string; // YYYY-MM-DD
  metodo: "efectivo" | "transferencia" | "cheque" | "otro";
  nota?: string;
};

// Registra el pago manual de una solicitud de socio:
//   1. Crea movimiento ingreso en el libro de caja con la cuenta y fecha
//      indicadas, usando la categoria "Cuota socio CdP" de la config.
//   2. Linkea el movimiento con la solicitud (socio_solicitudes.movimiento_id).
//   3. Marca la solicitud como pagada y guarda el nombre del metodo en
//      notas_internas (sumado a lo que ya tenia).
export async function registrarPagoManualSocio(
  input: RegistrarPagoManualInput
) {
  const profile = await requireDirectiva();
  if (!input.cuenta_id) throw new Error("Debes elegir una cuenta.");
  const supabase = await createSupabaseServerClient();

  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("id", input.solicitud_id)
    .maybeSingle();
  const solicitud = solData as
    | {
        id: string;
        apoderado_id: string | null;
        apoderado_nombre: string;
        periodo_anio: number;
        monto_cuota: number;
        estado: string;
        notas_internas: string | null;
        movimiento_id: string | null;
      }
    | null;
  if (!solicitud) throw new Error("Solicitud no encontrada.");
  if (solicitud.estado === "enviada" || solicitud.estado === "pagada") {
    throw new Error("Esta solicitud ya figura pagada.");
  }
  if (solicitud.movimiento_id) {
    throw new Error(
      "Esta solicitud ya tiene un movimiento asociado. Elimina el movimiento primero si quieres rehacer el pago."
    );
  }

  // Config: categoria para el movimiento
  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("categoria_cuota_id")
    .eq("id", 1)
    .maybeSingle();
  const categoriaId =
    (cfgData as { categoria_cuota_id: string | null } | null)?.categoria_cuota_id ??
    null;

  const metodoLabel: Record<string, string> = {
    efectivo: "Efectivo",
    transferencia: "Transferencia bancaria",
    cheque: "Cheque",
    otro: "Otro",
  };
  const descripcion = `Cuota socio CdP ${solicitud.periodo_anio} — ${solicitud.apoderado_nombre}`;

  const { data: movData, error: movErr } = await supabase
    .from("movimientos")
    .insert({
      fecha: input.fecha,
      tipo: "ingreso",
      monto: solicitud.monto_cuota,
      descripcion,
      categoria_id: categoriaId,
      cuenta_id: input.cuenta_id,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (movErr || !movData) {
    throw new Error(
      `No se pudo crear el movimiento: ${movErr?.message ?? "sin detalle"}`
    );
  }

  const notaCombinada = [
    solicitud.notas_internas?.trim(),
    `Pago manual (${metodoLabel[input.metodo]}) registrado el ${new Date().toLocaleDateString("es-CL")}.`,
    input.nota?.trim() ? `Nota: ${input.nota.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "pagada",
      pagada_en: new Date(input.fecha).toISOString(),
      movimiento_id: movData.id,
      notas_internas: notaCombinada || null,
    })
    .eq("id", input.solicitud_id);
  if (error) throw new Error(error.message);

  // Asegurar qr_token permanente del apoderado (si la solicitud estaba
  // vinculada a uno).
  if (solicitud.apoderado_id) {
    try {
      await obtenerOGenerarQrFamilia(supabase, solicitud.apoderado_id);
    } catch (err) {
      console.error(
        "Error asignando qr_token al apoderado tras registrar pago manual:",
        err instanceof Error ? err.message : err
      );
    }
  }

  revalidatePath("/socios");
  revalidatePath(`/socios/${input.solicitud_id}`);
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  return movData.id as string;
}

// Marcar como pagada SIN crear movimiento (fallback cuando el movimiento
// ya existe por otro flujo). Deprecada, mantener por compat con el admin
// viejo.
export async function marcarSolicitudPagada(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "pagada",
      pagada_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
}

export async function marcarSolicitudEnviada(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select("id, apoderado_id, periodo_anio")
    .eq("id", id)
    .maybeSingle();
  const sol = solData as {
    id: string;
    apoderado_id: string | null;
    periodo_anio: number;
  } | null;

  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "enviada",
      email_enviado_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Reflejar en apoderados si esta linkeado.
  if (sol?.apoderado_id) {
    await supabase
      .from("apoderados")
      .update({ socio: true, socio_periodo: sol.periodo_anio })
      .eq("id", sol.apoderado_id);
  }

  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
  revalidatePath("/apoderados");
}

// Helper interno: al rechazar o anular una solicitud, hace rollback de
// todos los efectos secundarios (elimina el movimiento ingreso del libro
// de caja + desmarca socio del apoderado si corresponde).
async function rollbackSolicitud(
  id: string,
  nuevoEstado: "rechazada" | "anulada",
  notas?: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select(
      "id, apoderado_id, periodo_anio, movimiento_id, estado, notas_internas"
    )
    .eq("id", id)
    .maybeSingle();
  const sol = solData as
    | {
        id: string;
        apoderado_id: string | null;
        periodo_anio: number;
        movimiento_id: string | null;
        estado: string;
        notas_internas: string | null;
      }
    | null;
  if (!sol) throw new Error("Solicitud no encontrada.");

  // Si tiene movimiento asociado, eliminarlo del libro de caja.
  if (sol.movimiento_id) {
    const { error: movErr } = await supabase
      .from("movimientos")
      .delete()
      .eq("id", sol.movimiento_id);
    if (movErr) {
      throw new Error(
        `No se pudo eliminar el movimiento asociado: ${movErr.message}`
      );
    }
  }

  // Si el apoderado quedo marcado como socio POR esta solicitud y no hay
  // otra solicitud activa del mismo periodo, desmarcar.
  if (
    sol.apoderado_id &&
    (sol.estado === "pagada" || sol.estado === "enviada")
  ) {
    const { count } = await supabase
      .from("socio_solicitudes")
      .select("id", { count: "exact", head: true })
      .eq("apoderado_id", sol.apoderado_id)
      .eq("periodo_anio", sol.periodo_anio)
      .in("estado", ["pagada", "enviada"])
      .neq("id", id);
    if ((count ?? 0) === 0) {
      await supabase
        .from("apoderados")
        .update({ socio: false, socio_periodo: null })
        .eq("id", sol.apoderado_id);
    }
  }

  // Preserva notas previas y agrega el registro del rollback.
  const timestamp = new Date().toLocaleDateString("es-CL");
  const nuevaNota = [
    sol.notas_internas?.trim(),
    `[${timestamp}] ${nuevoEstado === "rechazada" ? "Rechazada" : "Anulada"} desde el admin${notas?.trim() ? `. Motivo: ${notas.trim()}` : ""}${sol.movimiento_id ? ". Movimiento asociado eliminado del libro de caja." : ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: nuevoEstado,
      notas_internas: nuevaNota || null,
      movimiento_id: null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function rechazarSolicitud(id: string, notas?: string) {
  await requireDirectiva();
  await rollbackSolicitud(id, "rechazada", notas);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
  revalidatePath("/apoderados");
  revalidatePath("/movimientos");
  revalidatePath("/cuentas");
}

// Vincula una solicitud 'pendiente_match' (creada por el flujo manual del
// formulario publico) con una familia existente. Cambia estado a
// pendiente_pago para que siga el flujo normal (pagar o marcar pagada).
// Si la familia ya tiene otra solicitud activa en el periodo, falla
// avisando (para no duplicar: p.ej. el otro padre ya la inscribio).
export async function vincularSolicitudConApoderado(
  solicitudId: string,
  apoderadoId: string
) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: apoderadoData } = await supabase
    .from("apoderados")
    .select("id, nombre")
    .eq("id", apoderadoId)
    .maybeSingle();
  if (!apoderadoData) throw new Error("Familia no encontrada.");

  // Leer el periodo de la solicitud a vincular
  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select("periodo_anio, apoderado_email")
    .eq("id", solicitudId)
    .maybeSingle();
  const sol = solData as
    | { periodo_anio: number; apoderado_email: string }
    | null;
  if (!sol) throw new Error("Solicitud no encontrada.");

  // Chequear si la familia ya tiene otra solicitud activa de este periodo
  const { data: otraData } = await supabase
    .from("socio_solicitudes")
    .select("id, estado, apoderado_email")
    .eq("periodo_anio", sol.periodo_anio)
    .eq("apoderado_id", apoderadoId)
    .in("estado", ["pendiente_pago", "pagada", "enviada"])
    .neq("id", solicitudId)
    .maybeSingle();
  const otra = otraData as
    | { id: string; estado: string; apoderado_email: string }
    | null;
  if (otra) {
    throw new Error(
      `Esta familia ya tiene una solicitud ${otra.estado === "pagada" || otra.estado === "enviada" ? "pagada" : "en proceso"} desde el correo "${otra.apoderado_email}". No se puede vincular esta solicitud; anúlala desde el detalle para evitar duplicados.`
    );
  }

  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      apoderado_id: apoderadoId,
      // Si el nombre que escribio el apoderado no coincide con el de la
      // familia, dejamos el "oficial" (el del listado del colegio).
      apoderado_nombre: (apoderadoData as { nombre: string }).nombre,
      estado: "pendiente_pago",
    })
    .eq("id", solicitudId);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath(`/socios/${solicitudId}`);
}

// Busqueda rapida de apoderados por nombre, para el selector de
// "vincular familia" en el admin.
export async function buscarApoderadosAdmin(
  q: string
): Promise<Array<{ id: string; nombre: string; emails: string }>> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const trimmed = q.trim();
  if (!trimmed || trimmed.length < 2) return [];
  const { data: apoderadosData } = await supabase
    .from("apoderados")
    .select("id, nombre")
    .ilike("nombre", `%${trimmed}%`)
    .order("nombre")
    .limit(20);
  const apoderados =
    (apoderadosData as Array<{ id: string; nombre: string }> | null) ?? [];
  if (apoderados.length === 0) return [];
  const ids = apoderados.map((a) => a.id);
  const { data: contactosData } = await supabase
    .from("contactos")
    .select("apoderado_id, email")
    .in("apoderado_id", ids);
  const emailsPorApoderado = new Map<string, string[]>();
  for (const c of (contactosData ?? []) as Array<{
    apoderado_id: string;
    email: string | null;
  }>) {
    if (!c.email) continue;
    const arr = emailsPorApoderado.get(c.apoderado_id) ?? [];
    arr.push(c.email);
    emailsPorApoderado.set(c.apoderado_id, arr);
  }
  return apoderados.map((a) => ({
    id: a.id,
    nombre: a.nombre,
    emails: (emailsPorApoderado.get(a.id) ?? []).join(", "),
  }));
}

export async function anularSolicitud(id: string) {
  await requireDirectiva();
  await rollbackSolicitud(id, "anulada");
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
  revalidatePath("/apoderados");
  revalidatePath("/movimientos");
  revalidatePath("/cuentas");
}

// Genera el QR del socio y lo envia por correo via Resend. Actualiza
// estado a "enviada" y, si es un reenvio, incrementa el contador. Se usa
// desde el panel admin para "enviar QR" o "reenviar QR".
// Devuelve un objeto result en vez de throw para que el error no quede
// oculto por el runtime de Next.js en produccion ("Server Components
// render"). El cliente lee result.ok y si es false muestra el mensaje.
export async function registrarReenvioEmail(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireDirectiva();
  try {
    await enviarCorreoQrSocio(id);
    revalidatePath("/socios");
    revalidatePath(`/socios/${id}`);
    revalidatePath("/apoderados");
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al enviar el correo.";
    return { ok: false, error: mensaje };
  }
}
