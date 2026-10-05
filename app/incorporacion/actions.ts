"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";
import { todosLosCursos } from "@/lib/cursos";
import { crearCheckout, sumupHabilitado } from "@/lib/sumup/client";
import { siteUrl } from "@/lib/qr";

// Validacion basica de email (RFC-ish)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CrearSolicitudInput = {
  apoderado_nombre: string;
  apoderado_email: string;
  apoderado_rut?: string;
  apoderado_telefono?: string;
  alumno_nombre: string;
  curso: string;
};

// Server Action publica llamada desde /incorporacion. No requiere auth.
// Crea la solicitud en estado "pendiente_pago" y redirige a la pagina de
// pago con el token (que luego muestra el link SumUp o inicia checkout).
export async function crearSolicitudSocio(input: CrearSolicitudInput) {
  const nombre = input.apoderado_nombre.trim();
  const email = input.apoderado_email.trim().toLowerCase();
  const alumno = input.alumno_nombre.trim();
  const curso = input.curso.trim();

  if (!nombre || nombre.length < 3) {
    throw new Error("El nombre del apoderado es obligatorio.");
  }
  if (!EMAIL_RE.test(email)) {
    throw new Error("El correo electrónico no es válido.");
  }
  if (!alumno || alumno.length < 3) {
    throw new Error("El nombre del alumno es obligatorio.");
  }
  if (!todosLosCursos().includes(curso)) {
    throw new Error("Selecciona un curso válido de la lista.");
  }

  const supabase = await createSupabaseServerClient();

  // Config vigente (ano, monto)
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

  // Si ya existe una solicitud "enviada" para este email + alumno + periodo,
  // avisar en vez de duplicar (ya es socio activo).
  const { data: existente } = await supabase
    .from("socio_solicitudes")
    .select("estado, qr_token")
    .eq("periodo_anio", config.periodo_anio)
    .ilike("apoderado_email", email)
    .ilike("alumno_nombre", alumno)
    .in("estado", ["pagada", "enviada"])
    .maybeSingle();
  if (existente) {
    throw new Error(
      `Ya existe un socio activo del ${config.periodo_anio} con ese correo y alumno. Revisa tu bandeja de correo o contacta a la directiva si necesitas que te reenvíen el QR.`
    );
  }

  const { data: nueva, error } = await supabase
    .from("socio_solicitudes")
    .insert({
      periodo_anio: config.periodo_anio,
      apoderado_nombre: nombre,
      apoderado_email: email,
      apoderado_rut: input.apoderado_rut?.trim() || null,
      apoderado_telefono: input.apoderado_telefono?.trim() || null,
      alumno_nombre: alumno,
      curso,
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

  // Si SumUp API esta configurada, creamos un checkout dinamico y
  // guardamos el checkout_id para linkearlo con el webhook. Redirigimos
  // al apoderado directo al pago de SumUp.
  if (sumupHabilitado()) {
    try {
      const checkout = await crearCheckout({
        checkoutReference: `socio_${solicitud.id}`,
        amount: config.monto_cuota,
        currency: "CLP",
        description: `Cuota socio CdP ${config.periodo_anio} - ${alumno}`,
        returnUrl: `${siteUrl()}/incorporacion/pago?token=${solicitud.qr_token}`,
        payToEmail: email,
        payerName: nombre,
      });
      await supabase
        .from("socio_solicitudes")
        .update({ sumup_checkout_id: checkout.id })
        .eq("id", solicitud.id);

      // Si SumUp nos da una URL hosted, redirigimos ahi. Si no (p.ej.
      // porque el merchant no tiene hosted checkout habilitado),
      // caemos al flujo del link estatico.
      if (checkout.checkout_url) {
        redirect(checkout.checkout_url);
      }
    } catch {
      // Si falla la creacion del checkout, dejamos continuar al flujo
      // de link estatico asi al menos el apoderado puede pagar manual.
      // La directiva vera la solicitud en estado "pendiente_pago" y
      // podra marcarla pagada cuando llegue la transferencia.
    }
  }

  // Fallback (y modo "sin SumUp API"): a la pagina de pago estatico.
  redirect(`/incorporacion/pago?token=${solicitud.qr_token}`);
}
