// Logica compartida para generar el QR y enviar el correo al apoderado.
// Se llama tanto desde el webhook SumUp (automatico al confirmarse pago)
// como desde el panel admin cuando se reenvia manualmente.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/email/resend";
import { armarCorreoSocioHtml } from "@/lib/email/socio-template";
import { generarQrDataUrl, urlPublicaSocio } from "@/lib/qr";
import type { SocioSolicitud } from "@/lib/types";

export async function enviarCorreoQrSocio(
  solicitudId: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("id", solicitudId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Solicitud no encontrada.");
  const s = data as SocioSolicitud;

  const url = urlPublicaSocio(s.qr_token);
  const qrDataUrl = await generarQrDataUrl(url, { size: 400 });
  const { subject, html } = armarCorreoSocioHtml(s, qrDataUrl);

  await enviarCorreo({
    to: s.apoderado_email,
    subject,
    html,
  });

  // Marca como enviada e incrementa reenvios (si ya habia sido enviada antes).
  const { error: updErr } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "enviada",
      email_enviado_en: new Date().toISOString(),
      email_reenvios:
        s.email_enviado_en != null ? (s.email_reenvios ?? 0) + 1 : 0,
    })
    .eq("id", solicitudId);
  if (updErr) throw new Error(updErr.message);

  // Marca el apoderado como socio activo del periodo, si esta linkeado.
  // Hoy el flujo publico siempre linkea; esto cubre tambien los casos
  // manuales desde el admin donde se puede haber linkeado despues.
  if (s.apoderado_id) {
    await supabase
      .from("apoderados")
      .update({ socio: true, socio_periodo: s.periodo_anio })
      .eq("id", s.apoderado_id);
  }
}
