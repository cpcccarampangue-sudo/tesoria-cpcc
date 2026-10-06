"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
export async function crearSolicitudSocio(input: CrearSolicitudInput) {
  const key = await getRateLimitKey("incorp:crear");
  assertRateLimit(key, RL_SOLICITUD_MAX, RL_SOLICITUD_WIN_MS);

  const email = normalizarEmail(input.apoderado_email);
  if (!email) {
    throw new Error("El correo electrónico no es válido.");
  }
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
  await intentarRedirigirACheckout(solicitud, config, email, nombre);
  redirect(`/incorporacion/pago?token=${solicitud.qr_token}`);
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
