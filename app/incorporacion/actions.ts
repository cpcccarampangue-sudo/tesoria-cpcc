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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FamiliaIdentificada = {
  apoderado: Apoderado;
  contactos: Contacto[];
  estudiantes: Estudiante[];
};

// Paso 1 del flujo publico: identificar la familia por correo del contacto.
// Si la encuentra, devuelve los datos para que el apoderado los confirme
// en el paso 2. Si no, devuelve null y la UI muestra mensaje de error.
export async function buscarFamiliaPorEmail(
  email: string
): Promise<FamiliaIdentificada | null> {
  const emailNorm = email.trim().toLowerCase();
  if (!EMAIL_RE.test(emailNorm)) {
    throw new Error("El correo electrónico no es válido.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: contactoData } = await supabase
    .from("contactos")
    .select("*")
    .ilike("email", emailNorm)
    .limit(1)
    .maybeSingle();
  const contacto = contactoData as Contacto | null;
  if (!contacto) return null;

  const [{ data: apoderadoData }, { data: estudiantesData }, { data: contactosData }] =
    await Promise.all([
      supabase
        .from("apoderados")
        .select("*")
        .eq("id", contacto.apoderado_id)
        .maybeSingle(),
      supabase
        .from("estudiantes")
        .select("*")
        .eq("apoderado_id", contacto.apoderado_id)
        .eq("activo", true)
        .order("nombre"),
      supabase
        .from("contactos")
        .select("*")
        .eq("apoderado_id", contacto.apoderado_id)
        .order("relacion"),
    ]);

  const apoderado = apoderadoData as Apoderado | null;
  if (!apoderado) return null;

  return {
    apoderado,
    contactos: (contactosData as Contacto[] | null) ?? [contacto],
    estudiantes: (estudiantesData as Estudiante[] | null) ?? [],
  };
}

export type CrearSolicitudInput = {
  apoderado_id: string;
  apoderado_email: string;
  apoderado_telefono?: string;
  // IDs de estudiantes de la familia que quedan incluidos en el QR.
  estudiante_ids: string[];
};

// Paso 2 del flujo publico: confirmar los datos y crear la solicitud.
// La familia ya existe (viene del paso 1); el apoderado solo confirma
// que es su familia y marca que hijos incluir.
export async function crearSolicitudSocio(input: CrearSolicitudInput) {
  const email = input.apoderado_email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error("El correo electrónico no es válido.");
  }
  if (!input.estudiante_ids || input.estudiante_ids.length === 0) {
    throw new Error("Selecciona al menos un hijo para incluir en el QR.");
  }

  const supabase = await createSupabaseServerClient();

  // Validar que la familia existe y traer datos para armar la solicitud.
  const { data: apoderadoData } = await supabase
    .from("apoderados")
    .select("*")
    .eq("id", input.apoderado_id)
    .maybeSingle();
  const apoderado = apoderadoData as Apoderado | null;
  if (!apoderado) {
    throw new Error("Familia no encontrada. Vuelve a buscar tu correo.");
  }

  // Validar que los estudiantes seleccionados pertenecen a esta familia.
  const { data: estudiantesData } = await supabase
    .from("estudiantes")
    .select("*")
    .eq("apoderado_id", input.apoderado_id)
    .in("id", input.estudiante_ids);
  const estudiantes = (estudiantesData as Estudiante[] | null) ?? [];
  if (estudiantes.length === 0) {
    throw new Error("Los hijos seleccionados no corresponden a esta familia.");
  }

  // Config vigente
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

  // Validar duplicado: si esta familia ya tiene solicitud pagada o enviada
  // en este periodo, redirigir al pago en vez de crear otra.
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
      // Tiene una solicitud pendiente — la redirigimos a esa pagina de
      // pago en vez de duplicar.
      redirect(`/incorporacion/pago?token=${existente.qr_token}`);
    }
    throw new Error(
      `Esta familia ya figura como socia activa del año ${config.periodo_anio}. Si necesitas reemitir el QR, contacta a la directiva.`
    );
  }

  // Representacion resumen de los estudiantes incluidos para mostrar en
  // listas y correos sin tener que hacer join cada vez.
  const alumnoRepr = estudiantes.map((e) => e.nombre).join(", ");
  const cursoRepr = estudiantes
    .map((e) => e.curso ?? "—")
    .join(", ");

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

  // Si SumUp API esta configurada, crear checkout dinamico y redirigir.
  let urlSumUp: string | null = null;
  if (sumupHabilitado()) {
    try {
      const checkout = await crearCheckout({
        checkoutReference: `socio_${solicitud.id}`,
        amount: config.monto_cuota,
        currency: "CLP",
        description: `Cuota socio CdP ${config.periodo_anio} - ${apoderado.nombre}`,
        returnUrl: `${siteUrl()}/incorporacion/pago?token=${solicitud.qr_token}`,
        payToEmail: email,
        payerName: apoderado.nombre,
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
  }

  if (urlSumUp) {
    redirect(urlSumUp);
  }
  redirect(`/incorporacion/pago?token=${solicitud.qr_token}`);
}
