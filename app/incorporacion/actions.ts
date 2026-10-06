"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  emitirCodigo,
  verificarCodigo,
  obtenerSesion,
  consumirSesion,
  OTP_CONFIG,
} from "@/lib/otp/service";
import { enviarOtpEmail } from "@/lib/otp/email";
import type {
  Apoderado,
  Contacto,
  Estudiante,
  SocioConfig,
  SocioSolicitud,
} from "@/lib/types";
import { crearCheckout, sumupHabilitado } from "@/lib/sumup/client";
import { siteUrl } from "@/lib/qr";
import { todosLosCursos } from "@/lib/cursos";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizarEmail } from "@/lib/normalizar";

// Reexportamos desde el helper no-server para que la UI pueda importar
// detectarTipoBusqueda y los masks sin problemas de "use server".
import type { TipoBusqueda, FamiliaCandidata, ResultadoBusqueda } from "./tipos";
import { maskEmail, maskNombre } from "./tipos";
export type { TipoBusqueda, FamiliaCandidata, ResultadoBusqueda };

// IMPORTANTE: usamos el admin client (service_role) en este flujo
// publico porque las tablas contactos/apoderados/estudiantes tienen RLS
// restrictivo (solo directiva/apoderado-dueno pueden leer). Sin esto,
// la busqueda devuelve 0 filas para un usuario anonimo y el UI cree que
// la familia no existe. El admin client bypassa RLS, por eso las
// queries de este archivo filtran EXPLICITA y ESTRICTAMENTE por email
// normalizado — nunca devolvemos listados abiertos.

// Si queda algun comparador legacy que use regex de email, redirigir
// SIEMPRE a normalizarEmail(input) !== null — asi la normalizacion es
// la misma en todo el sistema.

const MAX_RESULTADOS = 5;

// Rate limits para endpoints publicos. Pensados para prevenir enumeracion
// masiva: un atacante no deberia poder barrer miles de correos para
// descubrir cuales son socios. Un apoderado real raras veces hace mas
// de 2-3 busquedas por sesion.
const RL_BUSQUEDA_MAX = 8;
const RL_BUSQUEDA_WIN_MS = 10 * 60 * 1000; // 8 en 10 min por IP
const RL_SOLICITUD_MAX = 5;
const RL_SOLICITUD_WIN_MS = 60 * 60 * 1000; // 5 en 1 hora por IP

async function getRateLimitKey(sufijo: string): Promise<string> {
  const h = await headers();
  return `${sufijo}:${clientIp(h)}`;
}

function assertRateLimit(key: string, max: number, windowMs: number) {
  const r = rateLimit(key, max, windowMs);
  if (!r.ok) {
    throw new Error(
      `Demasiados intentos. Vuelve a intentar en ${r.retryAfterSeconds} segundos.`
    );
  }
}

// Datos crudos de una familia resuelta por correo. INTERNO: solo se
// usa en el servidor. Nunca llega al cliente sin pasar por minimizacion.
export type FamiliaResuelta = {
  apoderado: Apoderado;
  contactos: Contacto[];
  estudiantes: Estudiante[];
  yaSocioToken: string | null; // si ya es socio vigente, su qr_token
  periodoVigente: number;
};

// Resuelve la familia asociada a un correo verificado. UNICA fuente de
// verdad para "quien es este email". Reutilizada por buscarFamilias (que
// enmascara para el flujo publico actual) y por el futuro flujo OTP (que
// podra devolver datos completos una vez verificado el correo).
//
// Reglas:
//   - Email ya debe venir normalizado (ver lib/normalizar.ts)
//   - Usa service_role: la query filtra ESTRICTAMENTE por el email y
//     limita cuantos registros procesa.
//   - No lanza por "no encontrado": devuelve null.
export async function resolverFamiliaPorEmail(
  emailNorm: string
): Promise<FamiliaResuelta | null> {
  const supabase = createSupabaseAdminClient();

  // 1) Buscar los contactos cuyo email coincida con el normalizado.
  //    Usamos filter con `lower(email)` para forzar comparacion case-
  //    insensitive consistente con el indice unique.
  const { data: contactosMatch, error: ctxErr } = await supabase
    .from("contactos")
    .select("apoderado_id, email")
    .ilike("email", emailNorm)
    .limit(MAX_RESULTADOS + 1);
  if (ctxErr) {
    throw new Error(`db:${ctxErr.code ?? "error"}`);
  }
  const apoderadoIds = Array.from(
    new Set(
      (contactosMatch ?? [])
        .map((r) => r.apoderado_id as string)
        .filter(Boolean)
    )
  );
  if (apoderadoIds.length === 0) return null;

  // Nos quedamos con el primero (en la practica no deberia haber varios
  // apoderados con el mismo correo porque el indice es unique por lower(email)).
  const apoderadoId = apoderadoIds[0];

  const [
    { data: cfgData },
    { data: apData },
    { data: ctxData },
    { data: estData },
  ] = await Promise.all([
    supabase.from("socio_config").select("periodo_anio").eq("id", 1).maybeSingle(),
    supabase.from("apoderados").select("*").eq("id", apoderadoId).maybeSingle(),
    supabase.from("contactos").select("*").eq("apoderado_id", apoderadoId),
    supabase
      .from("estudiantes")
      .select("*")
      .eq("apoderado_id", apoderadoId)
      .eq("activo", true),
  ]);

  const periodoVigente =
    (cfgData as { periodo_anio: number } | null)?.periodo_anio ??
    new Date().getFullYear();
  const apoderado = apData as Apoderado | null;
  if (!apoderado) return null;

  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select("qr_token, estado")
    .eq("apoderado_id", apoderadoId)
    .eq("periodo_anio", periodoVigente)
    .in("estado", ["pagada", "enviada"])
    .maybeSingle();

  return {
    apoderado,
    contactos: ((ctxData as Contacto[] | null) ?? []).sort((x, y) =>
      (x.nombre ?? "").localeCompare(y.nombre ?? "")
    ),
    estudiantes: ((estData as Estudiante[] | null) ?? []).sort((x, y) =>
      x.nombre.localeCompare(y.nombre)
    ),
    yaSocioToken: (solData as { qr_token: string } | null)?.qr_token ?? null,
    periodoVigente,
  };
}

// Busqueda publica para el flujo ACTUAL de /incorporacion (sin OTP
// todavia). Mantiene la minimizacion de datos. Deliberadamente NO
// permitimos busqueda por apellido o nombre de alumno en este flujo.
export async function buscarFamilias(
  consulta: string
): Promise<ResultadoBusqueda> {
  const emailNorm = normalizarEmail(consulta);
  if (!emailNorm) {
    throw new Error(
      "Ingresa un correo electrónico válido (ej. maria@ejemplo.cl)."
    );
  }

  // Rate limit por IP: previene enumeracion masiva.
  const key = await getRateLimitKey("incorp:buscar");
  assertRateLimit(key, RL_BUSQUEDA_MAX, RL_BUSQUEDA_WIN_MS);

  const tipo: TipoBusqueda = "email";

  const familia = await resolverFamiliaPorEmail(emailNorm);
  if (!familia) {
    return { tipo, familias: [], hayMas: false };
  }

  const contactosFiltrados = familia.contactos.filter((c) => c.email);
  return {
    tipo,
    familias: [
      {
        apoderadoId: familia.apoderado.id,
        apoderadoNombreMask: maskNombre(familia.apoderado.nombre ?? ""),
        contactosMask: contactosFiltrados.map((c) => ({
          emailMask: maskEmail(c.email as string),
        })),
        estudiantes: familia.estudiantes.map((e) => ({
          id: e.id,
          nombreMask: maskNombre(e.nombre),
          curso: e.curso ?? null,
        })),
        yaSocioToken: familia.yaSocioToken,
      },
    ],
    hayMas: false,
  };
}

export type CrearSolicitudInput = {
  apoderado_id: string;
  apoderado_email: string;
  apoderado_telefono?: string;
  estudiante_ids: string[];
};

// Flujo 1: la familia fue identificada en el listado, se linkea
// directamente al apoderado_id. El monto NUNCA viene del cliente:
// se toma siempre de socio_config en el servidor.
//
// REQUIERE sesion OTP valida con email == apoderado_email: previene
// que alguien que conoce el apoderado_id y correo cree solicitudes
// a nombre de la familia sin haber demostrado control del correo.
export async function crearSolicitudSocio(input: CrearSolicitudInput) {
  const key = await getRateLimitKey("incorp:crear");
  assertRateLimit(key, RL_SOLICITUD_MAX, RL_SOLICITUD_WIN_MS);

  const email = normalizarEmail(input.apoderado_email);
  if (!email) {
    throw new Error("El correo electrónico no es válido.");
  }
  const sesionId = await requerirSesionOtp(email);
  if (!input.estudiante_ids || input.estudiante_ids.length === 0) {
    throw new Error("No hay hijos vinculados para esta familia.");
  }

  const supabase = createSupabaseAdminClient();

  const { data: apoderadoData } = await supabase
    .from("apoderados")
    .select("*")
    .eq("id", input.apoderado_id)
    .maybeSingle();
  const apoderado = apoderadoData as Apoderado | null;
  if (!apoderado) {
    // Mensaje generico: no revela si el ID existe o no.
    throw new Error("No pudimos continuar con tu solicitud. Vuelve a buscar.");
  }

  const { data: estudiantesData } = await supabase
    .from("estudiantes")
    .select("*")
    .eq("apoderado_id", input.apoderado_id)
    .in("id", input.estudiante_ids);
  const estudiantes = (estudiantesData as Estudiante[] | null) ?? [];
  if (estudiantes.length === 0) {
    throw new Error("No pudimos continuar con tu solicitud. Vuelve a buscar.");
  }

  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const config = cfgData as SocioConfig | null;
  if (!config) {
    throw new Error(
      "El sistema de socios no está configurado. Contacta a la directiva."
    );
  }

  // Duplicado 1: misma familia + mismo periodo + estado activo.
  // Cubre el caso principal: si el padre ya pago, la madre al confirmar
  // es redirigida al mismo pago o rechazada si ya es socia.
  const { data: existenteData } = await supabase
    .from("socio_solicitudes")
    .select("qr_token, estado")
    .eq("periodo_anio", config.periodo_anio)
    .eq("apoderado_id", input.apoderado_id)
    .in("estado", ["pendiente_pago", "pagada", "enviada"])
    .maybeSingle();
  const existente = existenteData as
    | { qr_token: string; estado: string }
    | null;
  if (existente) {
    if (existente.estado === "pendiente_pago") {
      redirect(`/incorporacion/pago?token=${existente.qr_token}`);
    }
    throw new Error(
      `Esta familia ya figura como socia activa del año ${config.periodo_anio}. Si necesitas reemitir el QR, contacta a la directiva.`
    );
  }

  // Duplicado 2: solicitud "pendiente_match" (flujo manual sin apoderado_id)
  // cuyo email coincida con cualquier correo de los contactos de esta
  // familia. Caso: un padre llena el formulario manual porque no se
  // encontro, y despues la madre si encuentra la familia. Prevenimos
  // doble inscripcion de la misma familia por rutas distintas.
  const { data: emailsData } = await supabase
    .from("contactos")
    .select("email")
    .eq("apoderado_id", input.apoderado_id)
    .not("email", "is", null);
  const emailsFamilia = ((emailsData as { email: string | null }[] | null) ?? [])
    .map((c) => c.email?.toLowerCase().trim())
    .filter((e): e is string => !!e);
  if (emailsFamilia.length > 0) {
    const { data: pendienteManual } = await supabase
      .from("socio_solicitudes")
      .select("qr_token, apoderado_email")
      .eq("periodo_anio", config.periodo_anio)
      .is("apoderado_id", null)
      .in("estado", ["pendiente_match", "pendiente_pago", "pagada", "enviada"])
      .in("apoderado_email", emailsFamilia)
      .limit(1)
      .maybeSingle();
    if (pendienteManual) {
      // No revelamos el correo registrado, solo que hay actividad previa.
      throw new Error(
        `Ya hay una solicitud activa de esta familia. Contacta a la directiva para que la verifiquen antes de continuar.`
      );
    }
  }

  const alumnoRepr = estudiantes.map((e) => e.nombre).join(", ");
  const cursoRepr = estudiantes.map((e) => e.curso ?? "—").join(", ");

  const { data: nueva, error } = await supabase
    .from("socio_solicitudes")
    .insert({
      periodo_anio: config.periodo_anio,
      apoderado_id: input.apoderado_id,
      apoderado_nombre: apoderado.nombre,
      apoderado_email: email,
      apoderado_telefono: input.apoderado_telefono?.trim() || null,
      alumno_nombre: alumnoRepr,
      curso: cursoRepr,
      // Monto SIEMPRE del servidor, nunca del cliente.
      monto_cuota: config.monto_cuota,
    })
    .select("id, qr_token")
    .single();

  if (error || !nueva) {
    console.error("[incorporacion] insert solicitud fallo:", error?.code);
    throw new Error("No se pudo crear la solicitud. Intenta de nuevo.");
  }

  const solicitud = nueva as Pick<SocioSolicitud, "id" | "qr_token">;
  // Consumimos la sesion OTP: una verificacion de correo = una
  // incorporacion. Si quiere ingresar otra, OTP nuevo.
  await consumirSesion(sesionId);
  await intentarRedirigirACheckout(solicitud, config, email, apoderado.nombre);
  redirect(`/incorporacion/pago?token=${solicitud.qr_token}`);
}

export type HijoManual = {
  nombre: string;
  curso: string;
};

export type CrearSolicitudManualInput = {
  apoderado_nombre: string;
  apoderado_email: string;
  apoderado_rut?: string;
  apoderado_telefono?: string;
  hijos: HijoManual[];
};

// Flujo 2: la familia NO fue encontrada en el listado, el apoderado
// llena todos los datos a mano. La solicitud queda en estado
// 'pendiente_match' para que la directiva la vincule a la familia
// correcta antes de aceptar el pago.
export async function crearSolicitudManualSocio(
  input: CrearSolicitudManualInput
) {
  const key = await getRateLimitKey("incorp:crear");
  assertRateLimit(key, RL_SOLICITUD_MAX, RL_SOLICITUD_WIN_MS);

  const email = normalizarEmail(input.apoderado_email);
  const nombre = input.apoderado_nombre.trim();

  if (!nombre || nombre.length < 3) {
    throw new Error("Ingresa el nombre del apoderado.");
  }
  if (!email) {
    throw new Error("El correo electrónico no es válido.");
  }
  // REQUIERE sesion OTP valida con mismo email: el correo manual DEBE
  // haber sido verificado antes de crear la solicitud.
  const sesionId = await requerirSesionOtp(email);

  // Validacion de hijos: al menos uno, todos con nombre y curso valido.
  const hijosLimpios = (input.hijos ?? [])
    .map((h) => ({ nombre: h.nombre.trim(), curso: h.curso.trim() }))
    .filter((h) => h.nombre.length > 0 && h.curso.length > 0);
  if (hijosLimpios.length === 0) {
    throw new Error("Ingresa al menos un hijo con nombre y curso.");
  }
  const cursosValidos = todosLosCursos();
  for (const h of hijosLimpios) {
    if (h.nombre.length < 3) {
      throw new Error("El nombre del alumno debe tener al menos 3 caracteres.");
    }
    if (!cursosValidos.includes(h.curso)) {
      throw new Error(`Curso inválido para "${h.nombre}".`);
    }
  }

  // Concatenamos para los campos planos de la solicitud; la info completa
  // queda ahí para que la directiva la vea al vincular con la familia.
  const alumnoRepr = hijosLimpios.map((h) => h.nombre).join(", ");
  const cursoRepr = hijosLimpios.map((h) => h.curso).join(", ");

  const supabase = createSupabaseAdminClient();

  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const config = cfgData as SocioConfig | null;
  if (!config) {
    throw new Error("El sistema de socios no está configurado.");
  }

  // Prevenir que la misma persona envie 10 solicitudes manuales. Si ya
  // hay una pendiente de identificar o de pago con ese email y periodo,
  // la redirigimos a su pagina de pago en vez de duplicar.
  const { data: existenteData } = await supabase
    .from("socio_solicitudes")
    .select("qr_token, estado")
    .eq("periodo_anio", config.periodo_anio)
    .ilike("apoderado_email", email)
    .in("estado", ["pendiente_match", "pendiente_pago", "pagada", "enviada"])
    .maybeSingle();
  const existente = existenteData as
    | { qr_token: string; estado: string }
    | null;
  if (existente) {
    if (
      existente.estado === "pendiente_match" ||
      existente.estado === "pendiente_pago"
    ) {
      redirect(`/incorporacion/pago?token=${existente.qr_token}`);
    }
    throw new Error(
      `Ya existe un socio del ${config.periodo_anio} con ese correo. Contacta a la directiva si necesitas reemitir el QR.`
    );
  }

  const { data: nueva, error } = await supabase
    .from("socio_solicitudes")
    .insert({
      periodo_anio: config.periodo_anio,
      apoderado_id: null,
      apoderado_nombre: nombre,
      apoderado_email: email,
      apoderado_rut: input.apoderado_rut?.trim() || null,
      apoderado_telefono: input.apoderado_telefono?.trim() || null,
      alumno_nombre: alumnoRepr,
      curso: cursoRepr,
      // Monto SIEMPRE del servidor.
      monto_cuota: config.monto_cuota,
      estado: "pendiente_match",
    })
    .select("id, qr_token")
    .single();

  if (error || !nueva) {
    console.error("[incorporacion-manual] insert solicitud fallo:", error?.code);
    throw new Error("No se pudo crear la solicitud. Intenta de nuevo.");
  }

  const solicitud = nueva as Pick<SocioSolicitud, "id" | "qr_token">;
  // Consumimos la sesion OTP: una verificacion = una incorporacion.
  await consumirSesion(sesionId);
  await intentarRedirigirACheckout(solicitud, config, email, nombre);
  redirect(`/incorporacion/pago?token=${solicitud.qr_token}`);
}

// ===============================================================
// FLUJO OTP
// ===============================================================
// El UI nuevo va: email -> OTP -> post-verificacion -> caso A/B/C.
// Antes de que el OTP se verifique, el servidor NO revela ningun dato
// de la familia ni del socio. La respuesta al "solicitar codigo" es
// siempre la misma independiente de si el email existe o no.

const OTP_COOKIE = "otp_session";
const RL_OTP_SOLICITUD_MAX = 5;
const RL_OTP_SOLICITUD_WIN_MS = 60 * 60 * 1000; // 5/h por IP
const RL_OTP_VERIFICAR_MAX = 20;
const RL_OTP_VERIFICAR_WIN_MS = 60 * 60 * 1000; // 20/h por IP

export type SolicitarOtpResult =
  // Camino feliz / rate limit: NO revelamos si el email existe. Si hay
  // segundos restantes, el UI muestra el contador de reenvio.
  | { ok: true; reintentarEnSeg?: number }
  // Error interno (DB caida, pepper faltante, etc). El UI muestra un
  // mensaje generico sin exponer detalles.
  | { ok: false; motivo: "error_servicio" };

// Paso 1 publico: emite y envia un OTP al correo. En flujo normal
// SIEMPRE responde ok (con/sin reintentarEnSeg) para no permitir
// enumeracion. Si hay una excepcion NO ESPERADA (ej. migracion faltante,
// pepper no configurado, Supabase caido) devuelve ok=false con motivo
// generico para que el UI pueda mostrar "No pudimos enviar el codigo.
// Intenta de nuevo." sin filtrar detalle tecnico al cliente.
//
// Internamente:
//   - rate limit por IP (5/h) y por correo (3/15min via service).
//   - minimo 60s entre reenvios para el mismo correo.
//   - invalida codigos previos del mismo correo.
//   - loggea sin PII (solo correo enmascarado y resultado).
export async function solicitarOtp(email: string): Promise<SolicitarOtpResult> {
  try {
    const h = await headers();
    const ip = clientIp(h);

    const r = rateLimit(
      `otp:solicitar:${ip}`,
      RL_OTP_SOLICITUD_MAX,
      RL_OTP_SOLICITUD_WIN_MS
    );
    if (!r.ok) {
      return { ok: true, reintentarEnSeg: r.retryAfterSeconds ?? 60 };
    }

    const emailNorm = normalizarEmail(email);
    if (!emailNorm) {
      // Formato invalido. Igual devolvemos ok para no revelar.
      return { ok: true };
    }

    const emisor = await emitirCodigo(emailNorm, ip);
    if (!emisor.ok) {
      if (emisor.motivo === "reenvio_muy_rapido") {
        return { ok: true, reintentarEnSeg: emisor.segundosRestantes };
      }
      console.warn(
        "[otp] limite_por_correo",
        `email=${enmascararEmailLog(emailNorm)}`
      );
      return { ok: true };
    }

    try {
      await enviarOtpEmail(emailNorm, emisor.codigo);
    } catch (err) {
      const code = err instanceof Error ? err.name : "unknown";
      console.error("[otp] enviar email fallo:", code);
    }

    console.log(
      "[otp] solicitud",
      `email=${enmascararEmailLog(emailNorm)} ip=${ip} ok`
    );
    return { ok: true };
  } catch (err) {
    // Catch-all: cualquier excepcion no manejada (migracion faltante,
    // pepper no configurado, DB caida...) se registra server-side y se
    // devuelve un resultado tipado al cliente. NUNCA debe llegar al
    // render de un Server Component como excepcion.
    const msg = err instanceof Error ? err.message : "unknown";
    const name = err instanceof Error ? err.name : "Error";
    console.error("[otp] solicitarOtp error:", name, msg);
    return { ok: false, motivo: "error_servicio" };
  }
}

export type VerificarOtpResult =
  | { ok: true }
  | {
      ok: false;
      motivo:
        | "codigo_invalido"
        | "codigo_expirado"
        | "max_intentos"
        | "error_servicio";
    };

// Paso 2 publico: valida el codigo. Si OK, crea sesion y setea cookie
// HttpOnly / Secure / SameSite=Lax de 30 min.
export async function verificarOtp(
  email: string,
  codigo: string
): Promise<VerificarOtpResult> {
  try {
    const h = await headers();
    const ip = clientIp(h);

    const r = rateLimit(
      `otp:verificar:${ip}`,
      RL_OTP_VERIFICAR_MAX,
      RL_OTP_VERIFICAR_WIN_MS
    );
    if (!r.ok) {
      return { ok: false, motivo: "max_intentos" };
    }

    const emailNorm = normalizarEmail(email);
    const codigoLimpio = (codigo ?? "").replace(/\D/g, "").slice(0, 6);
    if (!emailNorm || codigoLimpio.length !== 6) {
      return { ok: false, motivo: "codigo_invalido" };
    }

    const res = await verificarCodigo(emailNorm, codigoLimpio, ip);
    if (!res.ok) {
      console.log(
        "[otp] verificar",
        `email=${enmascararEmailLog(emailNorm)} ip=${ip} motivo=${res.motivo}`
      );
      return res;
    }

    // Setear cookie segura. Max-Age en segundos.
    const c = await cookies();
    c.set(OTP_COOKIE, res.sesionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: OTP_CONFIG.SESION_TTL_MIN * 60,
    });

    console.log(
      "[otp] verificar",
      `email=${enmascararEmailLog(emailNorm)} ip=${ip} ok`
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const name = err instanceof Error ? err.name : "Error";
    console.error("[otp] verificarOtp error:", name, msg);
    return { ok: false, motivo: "error_servicio" };
  }
}

export type EstadoPostOtp =
  | { caso: "sin_sesion" }
  | { caso: "ya_socio"; qrToken: string }
  | {
      caso: "familia_existente";
      email: string;
      apoderadoId: string;
      apoderadoNombre: string;
      estudiantes: Array<{ id: string; nombre: string; curso: string | null }>;
    }
  | { caso: "nuevo"; email: string };

// Paso 3: solo despues de verificar el OTP el cliente llama esto para
// saber que mostrar. El dato de "existe o no" solo se revela aqui, con
// cookie valida; antes no. Si hay excepcion no esperada, devuelve
// sin_sesion para que el UI pida al usuario reintentar sin filtrar
// detalle tecnico.
export async function estadoPostOtp(): Promise<EstadoPostOtp> {
  try {
    const c = await cookies();
    const sid = c.get(OTP_COOKIE)?.value;
    if (!sid) return { caso: "sin_sesion" };
    const sesion = await obtenerSesion(sid);
    if (!sesion) return { caso: "sin_sesion" };

    const familia = await resolverFamiliaPorEmail(sesion.email);
    if (!familia) {
      return { caso: "nuevo", email: sesion.email };
    }

    if (familia.yaSocioToken) {
      return { caso: "ya_socio", qrToken: familia.yaSocioToken };
    }

    return {
      caso: "familia_existente",
      email: sesion.email,
      apoderadoId: familia.apoderado.id,
      apoderadoNombre: familia.apoderado.nombre,
      estudiantes: familia.estudiantes.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        curso: e.curso ?? null,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const name = err instanceof Error ? err.name : "Error";
    console.error("[otp] estadoPostOtp error:", name, msg);
    return { caso: "sin_sesion" };
  }
}

// Helper interno: valida que la cookie OTP corresponde a un email
// verificado y que ese email coincide con el que viene del cliente.
// Lanza con mensaje generico si no.
async function requerirSesionOtp(email: string): Promise<string> {
  const c = await cookies();
  const sid = c.get(OTP_COOKIE)?.value;
  if (!sid) throw new Error("Tu sesión expiró. Vuelve a ingresar el código.");
  const sesion = await obtenerSesion(sid);
  if (!sesion) {
    throw new Error("Tu sesión expiró. Vuelve a ingresar el código.");
  }
  if (sesion.email !== normalizarEmail(email)) {
    // No decimos "no coincide" para no filtrar informacion; si el
    // cliente trato de usar la sesion con otro correo, es sospechoso.
    throw new Error("Tu sesión expiró. Vuelve a ingresar el código.");
  }
  return sesion.id;
}

export async function cerrarSesionOtp(): Promise<void> {
  const c = await cookies();
  c.delete(OTP_COOKIE);
}

// Enmascara un email para logs: pamela.rodriguez@gmail.com -> p******@g****.com
function enmascararEmailLog(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const dom = email.slice(at + 1);
  const dotDom = dom.indexOf(".");
  const dom1 = dotDom > 0 ? dom.slice(0, dotDom) : dom;
  const dom2 = dotDom > 0 ? dom.slice(dotDom) : "";
  return `${local[0]}***@${dom1[0]}***${dom2}`;
}

// Helper interno: crea checkout SumUp (si esta configurado) y guarda
// la url para que el llamador haga el redirect fuera del try/catch.
// Devuelve si se guardo el checkout_id en la solicitud.
async function intentarRedirigirACheckout(
  solicitud: Pick<SocioSolicitud, "id" | "qr_token">,
  config: SocioConfig,
  email: string,
  nombreFamilia: string
): Promise<void> {
  if (!sumupHabilitado()) return;
  let urlSumUp: string | null = null;
  try {
    const supabase = createSupabaseAdminClient();
    const checkout = await crearCheckout({
      checkoutReference: `socio_${solicitud.id}`,
      amount: config.monto_cuota,
      currency: "CLP",
      description: `Cuota socio CdP ${config.periodo_anio} - ${nombreFamilia}`,
      returnUrl: `${siteUrl()}/incorporacion/pago?token=${solicitud.qr_token}`,
      payToEmail: email,
      payerName: nombreFamilia,
    });
    await supabase
      .from("socio_solicitudes")
      .update({ sumup_checkout_id: checkout.id })
      .eq("id", solicitud.id);
    if (checkout.checkout_url) {
      urlSumUp = checkout.checkout_url;
    }
  } catch (err) {
    // Log sin PII, solo codigo de error si existe. El mensaje completo
    // puede traer datos del checkout o del email.
    const code = err instanceof Error ? err.name : "unknown";
    console.error("[incorporacion] SumUp crearCheckout fallo:", code);
  }
  if (urlSumUp) {
    redirect(urlSumUp);
  }
}
