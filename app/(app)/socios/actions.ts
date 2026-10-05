"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";

// Config
export type ActualizarConfigInput = {
  periodo_anio: number;
  periodo_inicio: string | null; // "YYYY-MM-DD"
  periodo_fin: string | null;
  monto_cuota: number;
  sumup_link: string | null;
  mensaje_bienvenida: string | null;
};

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
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("socio_config")
    .update({
      periodo_anio: input.periodo_anio,
      periodo_inicio: input.periodo_inicio,
      periodo_fin: input.periodo_fin,
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

// Vincula una solicitud 'pendiente_match' (creada por el flujo manual del
// formulario publico) con una familia existente. Cambia estado a
// pendiente_pago para que siga el flujo normal (pagar o marcar pagada).
export async function vincularSolicitudConApoderado(
  solicitudId: string,
  apoderadoId: string
) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  // Validar que el apoderado existe
  const { data: apoderadoData } = await supabase
    .from("apoderados")
    .select("id, nombre")
    .eq("id", apoderadoId)
    .maybeSingle();
  if (!apoderadoData) throw new Error("Familia no encontrada.");

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
