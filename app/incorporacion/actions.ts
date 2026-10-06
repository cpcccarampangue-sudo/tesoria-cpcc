"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reexportamos desde el helper no-server para que la UI pueda importar
// detectarTipoBusqueda y los masks sin problemas de "use server".
import type { TipoBusqueda, FamiliaCandidata, ResultadoBusqueda } from "./tipos";
import { maskEmail, maskNombre } from "./tipos";
export type { TipoBusqueda, FamiliaCandidata, ResultadoBusqueda };

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

// Busqueda publica de familias: SOLO por email exacto del contacto.
// Deliberadamente NO permitimos busqueda por apellido o nombre de
// alumno en este flujo para proteger datos personales de las familias:
// alguien podria enumerar la lista completa escaneando apellidos.
// La busqueda por apellido/alumno existe en el admin (/socios/nuevo)
// donde solo accede la directiva autenticada.
export async function buscarFamilias(
  consulta: string
): Promise<ResultadoBusqueda> {
  const trimmed = consulta.trim();
  if (!trimmed) {
    throw new Error("Ingresa el correo electrónico del apoderado.");
  }

  // Validacion estricta: solo aceptamos email con formato valido. El
  // mensaje aqui no revela si el correo existe en la base: solo valida
  // formato.
  if (!EMAIL_RE.test(trimmed)) {
    throw new Error(
      "Ingresa un correo electrónico válido (ej. maria@ejemplo.cl)."
    );
  }

  // Rate limit por IP: previene enumeracion masiva. La respuesta del
  // endpoint intencionalmente NO distingue entre "sin coincidencias"
  // y "familia encontrada": en ambos casos el formulario cliente
  // avanza al paso siguiente. Esto reduce el valor de barrer correos.
  const key = await getRateLimitKey("incorp:buscar");
  assertRateLimit(key, RL_BUSQUEDA_MAX, RL_BUSQUEDA_WIN_MS);

  const tipo: TipoBusqueda = "email";
  const supabase = await createSupabaseServerClient();

  // Email exacto (case-insensitive). No usamos "like" con wildcards.
  const { data } = await supabase
    .from("contactos")
    .select("apoderado_id")
    .ilike("email", trimmed.toLowerCase())
    .limit(MAX_RESULTADOS + 1);
  const apoderadoIds = Array.from(
    new Set((data ?? [])
      .map((r) => r.apoderado_id as string)
      .filter(Boolean))
  );

  if (apoderadoIds.length === 0) {
    return { tipo, familias: [], hayMas: false };
  }

  const hayMas = apoderadoIds.length > MAX_RESULTADOS;
  const idsAUsar = apoderadoIds.slice(0, MAX_RESULTADOS);

  // Config vigente para saber el periodo activo al consultar solicitudes.
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
    { data: solicitudesData },
  ] = await Promise.all([
    supabase.from("apoderados").select("id, nombre").in("id", idsAUsar),
    supabase
      .from("contactos")
      .select("apoderado_id, email, nombre")
      .in("apoderado_id", idsAUsar),
    supabase
      .from("estudiantes")
      .select("id, apoderado_id, nombre, curso")
      .in("apoderado_id", idsAUsar)
      .eq("activo", true),
    supabase
      .from("socio_solicitudes")
      .select("apoderado_id, qr_token, estado")
      .in("apoderado_id", idsAUsar)
      .eq("periodo_anio", periodoVigente)
      .in("estado", ["pagada", "enviada"]),
  ]);

  const apoderadosMap = new Map<string, { id: string; nombre: string }>();
  for (const a of (apoderadosData ?? []) as { id: string; nombre: string }[]) {
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
  const yaSocioMap = new Map<string, string>(); // apoderado_id -> qr_token
  for (const s of (solicitudesData ?? []) as {
    apoderado_id: string;
    qr_token: string;
  }[]) {
    yaSocioMap.set(s.apoderado_id, s.qr_token);
  }

  const familias: FamiliaCandidata[] = [];
  for (const id of idsAUsar) {
    const a = apoderadosMap.get(id);
    if (!a) continue;
    const contactosOrdenados = (contactosMap.get(id) ?? []).sort((x, y) =>
      (x.nombre ?? "").localeCompare(y.nombre ?? "")
    );
    const estudiantesOrdenados = (estudiantesMap.get(id) ?? []).sort((x, y) =>
      x.nombre.localeCompare(y.nombre)
    );
    familias.push({
      apoderadoId: a.id,
      apoderadoNombreMask: maskNombre(a.nombre ?? ""),
      contactosMask: contactosOrdenados
        .filter((c) => c.email)
        .map((c) => ({ emailMask: maskEmail(c.email as string) })),
      estudiantes: estudiantesOrdenados.map((e) => ({
        id: e.id,
        nombreMask: maskNombre(e.nombre),
        curso: e.curso ?? null,
      })),
      yaSocioToken: yaSocioMap.get(id) ?? null,
    });
  }

  return { tipo, familias, hayMas };
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

  const email = input.apoderado_email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error("El correo electrónico no es válido.");
  }
  if (!input.estudiante_ids || input.estudiante_ids.length === 0) {
    throw new Error("No hay hijos vinculados para esta familia.");
  }

  const supabase = await createSupabaseServerClient();

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

  const email = input.apoderado_email.trim().toLowerCase();
  const nombre = input.apoderado_nombre.trim();

  if (!nombre || nombre.length < 3) {
    throw new Error("Ingresa el nombre del apoderado.");
  }
  if (!EMAIL_RE.test(email)) {
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

  const supabase = await createSupabaseServerClient();

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
    const supabase = await createSupabaseServerClient();
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
