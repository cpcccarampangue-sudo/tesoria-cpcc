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
const RUT_RE = /^[0-9kK.\-\s]+$/;

export type TipoBusqueda = "email" | "rut" | "alumno";

export type FamiliaCandidata = {
  apoderado: Apoderado;
  contactos: Contacto[];
  estudiantes: Estudiante[];
};

export type ResultadoBusqueda = {
  tipo: TipoBusqueda;
  familias: FamiliaCandidata[];
  // true si hay mas resultados que los devueltos (hay que refinar).
  hayMas: boolean;
};

// Normaliza un RUT: solo numeros y 'K', en minusculas, sin puntos ni
// guiones. Usamos esta forma para comparar.
function normalizarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, "").toLowerCase();
}

// Decide que tipo de busqueda hacer segun lo que viene del usuario.
export function detectarTipoBusqueda(input: string): TipoBusqueda {
  const trimmed = input.trim();
  if (trimmed.includes("@") && EMAIL_RE.test(trimmed)) return "email";
  if (RUT_RE.test(trimmed) && /\d/.test(trimmed) && trimmed.length >= 7) {
    return "rut";
  }
  return "alumno";
}

const MAX_RESULTADOS = 10;

// Busqueda flexible: email, RUT o nombre/apellido del alumno. Devuelve
// hasta MAX_RESULTADOS familias; si hay mas, pide al usuario refinar.
export async function buscarFamilias(
  consulta: string
): Promise<ResultadoBusqueda> {
  const trimmed = consulta.trim();
  if (!trimmed) {
    throw new Error("Ingresa un correo, RUT o nombre del alumno para buscar.");
  }

  const tipo = detectarTipoBusqueda(trimmed);
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
  } else if (tipo === "rut") {
    const rutNorm = normalizarRut(trimmed);
    // Fetch mas contactos para filtrar en memoria por rut normalizado
    // (no podemos indexar con regexp en la query sin funcion personalizada).
    const { data } = await supabase
      .from("contactos")
      .select("apoderado_id, rut")
      .not("rut", "is", null)
      .limit(500); // pool razonable del colegio
    apoderadoIds = Array.from(
      new Set(
        (data ?? [])
          .filter(
            (r: { rut: string | null }) =>
              r.rut && normalizarRut(r.rut) === rutNorm
          )
          .map((r) => (r as { apoderado_id: string }).apoderado_id)
      )
    );
  } else {
    // tipo === "alumno"
    const { data } = await supabase
      .from("estudiantes")
      .select("apoderado_id")
      .ilike("nombre", `%${trimmed}%`)
      .eq("activo", true)
      .limit(MAX_RESULTADOS + 1);
    apoderadoIds = Array.from(
      new Set((data ?? []).map((r) => r.apoderado_id as string))
    );
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

  // Duplicado: misma familia + mismo periodo + estado activo
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

export type CrearSolicitudManualInput = {
  apoderado_nombre: string;
  apoderado_email: string;
  apoderado_rut?: string;
  apoderado_telefono?: string;
  alumno_nombre: string;
  curso: string;
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
  const alumno = input.alumno_nombre.trim();
  const curso = input.curso.trim();

  if (!nombre || nombre.length < 3) {
    throw new Error("Ingresa el nombre del apoderado.");
  }
  if (!EMAIL_RE.test(email)) {
    throw new Error("El correo electrónico no es válido.");
  }
  if (!alumno || alumno.length < 3) {
    throw new Error("Ingresa el nombre del alumno.");
  }
  if (!todosLosCursos().includes(curso)) {
    throw new Error("Selecciona un curso válido.");
  }

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
      alumno_nombre: alumno,
      curso,
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
