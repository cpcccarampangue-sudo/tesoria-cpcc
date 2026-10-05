"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";

// Config
export type ActualizarConfigInput = {
  periodo_anio: number;
  monto_cuota: number;
  sumup_link: string | null;
  mensaje_bienvenida: string | null;
};

export async function actualizarSocioConfig(input: ActualizarConfigInput) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("socio_config")
    .update({
      periodo_anio: input.periodo_anio,
      monto_cuota: input.monto_cuota,
      sumup_link: input.sumup_link,
      mensaje_bienvenida: input.mensaje_bienvenida,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath("/socios/config");
  revalidatePath("/incorporacion");
}

// Marcar como pagada manualmente (fallback cuando no hay webhook SumUp
// o cuando el pago llego por otro medio, p.ej. transferencia directa).
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

export async function rechazarSolicitud(id: string, notas?: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "rechazada",
      notas_internas: notas ?? null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
}

export async function anularSolicitud(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("socio_solicitudes")
    .update({ estado: "anulada" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
}

// Genera el QR del socio y lo envia por correo via Resend. Actualiza
// estado a "enviada" y, si es un reenvio, incrementa el contador. Se usa
// desde el panel admin para "enviar QR" o "reenviar QR".
export async function registrarReenvioEmail(id: string) {
  await requireDirectiva();
  await enviarCorreoQrSocio(id);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
  revalidatePath("/apoderados");
}
