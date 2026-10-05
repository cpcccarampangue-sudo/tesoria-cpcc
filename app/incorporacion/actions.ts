"use server";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reexportamos desde el helper no-server para que la UI pueda importar
// detectarTipoBusqueda sin problemas de "use server".
import type { TipoBusqueda, FamiliaCandidata, ResultadoBusqueda } from "./tipos";
export type { TipoBusqueda, FamiliaCandidata, ResultadoBusqueda };

const MAX_RESULTADOS = 10;

// Busqueda flexible: email del contacto o apellido de familia/alumno.
// Para "nombre" matchea en apoderados.nombre (rotulo "Apellido1 Apellido2"
// del Excel del colegio) y en estudiantes.nombre. Devuelve hasta
// MAX_RESULTADOS familias; si hay mas, pide al usuario refinar.
export async function buscarFamilias(
  consulta: string
): Promise<ResultadoBusqueda> {
  const trimmed = consulta.trim();
  if (!trimmed) {
    throw new Error("Ingresa un correo o apellido para buscar.");
  }

  const tipo: TipoBusqueda = trimmed.includes("@") && EMAIL_RE.test(trimmed) ? "email" : "nombre";
  const supabase = await createSupabaseServerClient();

  // Set de apoderado_ids encontrados segun el criterio.
  let apoderadoIds: string[] = [];

  if (tipo === "email") {
    const { data } = await supabase
      .from("contactos")
      .select("apoderado_id")
      .ilike("email", trimmed.toLowerCase())
      .limit(MAX_RESULTADOS + 1);
    apoderadoIds = (data ?? [])
      .map((r) => r.apoderado_id as string)
      .filter(Boolean);
  } else {
    // tipo === "nombre": buscar en apellido de familia y en nombre de alumno
    const [{ data: porFamilia }, { data: porAlumno }] = await Promise.all([
      supabase
        .from("apoderados")
        .select("id")
        .ilike("nombre", `%${trimmed}%`)
        .limit(MAX_RESULTADOS + 1),
      supabase
        .from("estudiantes")
        .select("apoderado_id")
        .ilike("nombre", `%${trimmed}%`)
        .eq("activo", true)
        .limit(MAX_RESULTADOS + 1),
    ]);
    const ids = new Set<string>();
    for (const r of porFamilia ?? []) ids.add((r as { id: string }).id);
    for (const r of porAlumno ?? [])
      ids.add((r as { apoderado_id: string }).apoderado_id);
    apoderadoIds = Array.from(ids);
  }

  if (apoderadoIds.length === 0) {
    return { tipo, familias: [], hayMas: false };
  }

  const hayMas = apoderadoIds.length > MAX_RESULTADOS;
  const idsAUsar = apoderadoIds.slice(0, MAX_RESULTADOS);

  const [{ data: apoderadosData }, { data: contactosData }, { data: estudiantesData }] =
    await Promise.all([
      supabase.from("apoderados").select("*").in("id", idsAUsar),
      supabase.from("contactos").select("*").in("apoderado_id", idsAUsar),
      supabase
        .from("estudiantes")
        .select("*")
        .in("apoderado_id", idsAUsar)
        .eq("activo", true),
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

  const familias: FamiliaCandidata[] = [];
  for (const id of idsAUsar) {
    const a = apoderadosMap.get(id);
    if (!a) continue;
    familias.push({
      apoderado: a,
      contactos: (contactosMap.get(id) ?? []).sort((x, y) =>
        x.nombre.localeCompare(y.nombre)
      ),
      estudiantes: (estudiantesMap.get(id) ?? []).sort((x, y) =>
        x.nombre.localeCompare(y.nombre)
      ),
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
// directamente al apoderado_id.
export async function crearSolicitudSocio(input: CrearSolicitudInput) {
  const email = input.apoderado_email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error("El correo electrónico no es válido.");
  }
  if (!input.estudiante_ids || input.estudiante_ids.length === 0) {
    throw new Error("Selecciona al menos un hijo para incluir en el QR.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: apoderadoData } = await supabase
    .from("apoderados")
    .select("*")
    .eq("id", input.apoderado_id)
    .maybeSingle();
  const apoderado = apoderadoData as Apoderado | null;
  if (!apoderado) {
    throw new Error("Familia no encontrada. Vuelve a buscar.");
  }

  const { data: estudiantesData } = await supabase
    .from("estudiantes")
    .select("*")
    .eq("apoderado_id", input.apoderado_id)
    .in("id", input.estudiante_ids);
  const estudiantes = (estudiantesData as Estudiante[] | null) ?? [];
  if (estudiantes.length === 0) {
    throw new Error("Los hijos seleccionados no corresponden a esta familia.");
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
      const otra = pendienteManual as {
        qr_token: string;
        apoderado_email: string;
      };
      throw new Error(
        `Ya hay una solicitud activa de esta familia enviada desde el correo "${otra.apoderado_email}". Contacta a la directiva para que la verifiquen antes de continuar.`
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
      monto_cuota: config.monto_cuota,
    })
    .select("id, qr_token")
    .single();

  if (error || !nueva) {
    throw new Error(
      error?.message ?? "No se pudo crear la solicitud. Intenta de nuevo."
    );
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
      monto_cuota: config.monto_cuota,
      estado: "pendiente_match",
    })
    .select("id, qr_token")
    .single();

  if (error || !nueva) {
    throw new Error(
      error?.message ?? "No se pudo crear la solicitud. Intenta de nuevo."
    );
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
    console.error(
      "[incorporacion] SumUp crearCheckout fallo:",
      err instanceof Error ? err.message : err
    );
  }
  if (urlSumUp) {
    redirect(urlSumUp);
  }
}
