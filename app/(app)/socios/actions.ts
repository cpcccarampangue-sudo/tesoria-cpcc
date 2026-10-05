"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "enviada",
      email_enviado_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
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

// Incrementa contador y actualiza timestamp de reenvio. El envio real del
// correo lo hace la integracion con Resend (TODO fase 2).
export async function registrarReenvioEmail(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: actual } = await supabase
    .from("socio_solicitudes")
    .select("email_reenvios")
    .eq("id", id)
    .maybeSingle();
  const n = (actual as { email_reenvios?: number } | null)?.email_reenvios ?? 0;
  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      email_reenvios: n + 1,
      email_enviado_en: new Date().toISOString(),
      estado: "enviada",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/socios");
  revalidatePath(`/socios/${id}`);
}
