// Logica compartida para generar el QR y enviar el correo al apoderado.
// Se llama tanto desde el webhook SumUp (automatico al confirmarse pago)
// como desde el panel admin cuando se reenvia manualmente.
//
// Modelo QR permanente (Fase C): el QR va al correo es apoderados.qr_token.
// Modelo tipo correo (Fase D + migracion 032): el tipo bienvenida/renovacion
// se lee del snapshot inmutable socio_solicitudes.tipo_correo. Si NULL
// (solicitudes legacy), se recalcula al momento.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/email/mailer";
import { armarCorreoSocioHtml } from "@/lib/email/socio-template";
import { generarQrDataUrl, urlPublicaSocio } from "@/lib/qr";
import { obtenerOGenerarQrFamilia } from "@/lib/socios/qr-familia";
import { determinarTipoCorreo } from "@/lib/socios/tipo-correo";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";

export async function enviarCorreoQrSocio(
  solicitudId: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: cfgData }] = await Promise.all([
    supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("id", solicitudId)
      .maybeSingle(),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Solicitud no encontrada.");
  const s = data as SocioSolicitud;
  const config = cfgData as SocioConfig | null;

  // QR canonico del apoderado (reutiliza o genera + persiste).
  let qrTokenPublico: string;
  if (s.apoderado_id) {
    qrTokenPublico = await obtenerOGenerarQrFamilia(supabase, s.apoderado_id);
  } else {
    qrTokenPublico = s.qr_token;
  }

  const url = urlPublicaSocio(qrTokenPublico);
  const qrDataUrl = await generarQrDataUrl(url, { size: 400 });

  // Tipo de correo: snapshot inmutable si existe (migracion 032); si NULL
  // (legacy), recalcular. El recalculo puede ser inexacto si entretanto
  // ya se actualizo apoderados.socio_periodo, pero es best-effort para
  // solicitudes previas a 2026-10-08.
  const tipo =
    s.tipo_correo ??
    (await determinarTipoCorreo(
      supabase,
      s.apoderado_id,
      s.periodo_anio,
      s.id
    ));

  const { subject, html } = armarCorreoSocioHtml({
    solicitud: s,
    qrDataUrl,
    qrTokenPublico,
    tipo,
    config,
  });

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

  // Marca el apoderado como socio activo del periodo. Esto puede
  // sobrescribir socio_periodo del valor historico (ej. 2026 -> 2027),
  // pero YA no afecta la decision del tipo_correo que quedo snapshot.
  if (s.apoderado_id) {
    await supabase
      .from("apoderados")
      .update({ socio: true, socio_periodo: s.periodo_anio })
      .eq("id", s.apoderado_id);
  }
}
