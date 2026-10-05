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

export type RegistrarPagoManualInput = {
  solicitud_id: string;
  cuenta_id: string;
  fecha: string; // YYYY-MM-DD
  metodo: "efectivo" | "transferencia" | "cheque" | "otro";
  nota?: string;
};

// Registra el pago manual de una solicitud de socio:
//   1. Crea movimiento ingreso en el libro de caja con la cuenta y fecha
//      indicadas, usando la categoria "Cuota socio CdP" de la config.
//   2. Linkea el movimiento con la solicitud (socio_solicitudes.movimiento_id).
//   3. Marca la solicitud como pagada y guarda el nombre del metodo en
//      notas_internas (sumado a lo que ya tenia).
export async function registrarPagoManualSocio(
  input: RegistrarPagoManualInput
) {
  const profile = await requireDirectiva();
  if (!input.cuenta_id) throw new Error("Debes elegir una cuenta.");
  const supabase = await createSupabaseServerClient();

  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("id", input.solicitud_id)
    .maybeSingle();
  const solicitud = solData as
    | {
        id: string;
        apoderado_id: string | null;
        apoderado_nombre: string;
        periodo_anio: number;
        monto_cuota: number;
        estado: string;
        notas_internas: string | null;
        movimiento_id: string | null;
      }
    | null;
  if (!solicitud) throw new Error("Solicitud no encontrada.");
  if (solicitud.estado === "enviada" || solicitud.estado === "pagada") {
    throw new Error("Esta solicitud ya figura pagada.");
  }
  if (solicitud.movimiento_id) {
    throw new Error(
      "Esta solicitud ya tiene un movimiento asociado. Elimina el movimiento primero si quieres rehacer el pago."
    );
  }

  // Config: categoria para el movimiento
  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("categoria_cuota_id")
    .eq("id", 1)
    .maybeSingle();
  const categoriaId =
    (cfgData as { categoria_cuota_id: string | null } | null)?.categoria_cuota_id ??
    null;

  const metodoLabel: Record<string, string> = {
    efectivo: "Efectivo",
    transferencia: "Transferencia bancaria",
    cheque: "Cheque",
    otro: "Otro",
  };
  const descripcion = `Cuota socio CdP ${solicitud.periodo_anio} — ${solicitud.apoderado_nombre}`;

  const { data: movData, error: movErr } = await supabase
    .from("movimientos")
    .insert({
      fecha: input.fecha,
      tipo: "ingreso",
      monto: solicitud.monto_cuota,
      descripcion,
      categoria_id: categoriaId,
      cuenta_id: input.cuenta_id,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (movErr || !movData) {
    throw new Error(
      `No se pudo crear el movimiento: ${movErr?.message ?? "sin detalle"}`
    );
  }

  const notaCombinada = [
    solicitud.notas_internas?.trim(),
    `Pago manual (${metodoLabel[input.metodo]}) registrado el ${new Date().toLocaleDateString("es-CL")}.`,
    input.nota?.trim() ? `Nota: ${input.nota.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "pagada",
      pagada_en: new Date(input.fecha).toISOString(),
      movimiento_id: movData.id,
      notas_internas: notaCombinada || null,
    })
    .eq("id", input.solicitud_id);
  if (error) throw new Error(error.message);

  revalidatePath("/socios");
  revalidatePath(`/socios/${input.solicitud_id}`);
  revalidatePath("/movimientos");
  revalidatePath("/dashboard");
  revalidatePath("/cuentas");
  return movData.id as string;
}

// Marcar como pagada SIN crear movimiento (fallback cuando el movimiento
// ya existe por otro flujo). Deprecada, mantener por compat con el admin
// viejo.
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
