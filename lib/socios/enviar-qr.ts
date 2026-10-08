// Logica compartida para generar el QR y enviar el correo al apoderado.
// Dos modos de invocacion:
//   - Reenvio manual (admin): envia SIEMPRE. Incrementa email_reenvios si
//     ya habia enviado antes. Compat con callers viejos.
//   - Idempotente (webhook/reconciliacion): envia SOLO si no se envio
//     antes, protegido por claim atomico (claim_email_envio_lock) para
//     que ejecuciones concurrentes no dupliquen el correo.
//
// Modelo QR permanente: el QR va al correo es apoderados.qr_token.
// Tipo correo (bienvenida/renovacion): snapshot inmutable
// socio_solicitudes.tipo_correo con fallback a recalculo.

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enviarCorreo } from "@/lib/email/mailer";
import { armarCorreoSocioHtml } from "@/lib/email/socio-template";
import { generarQrDataUrl, urlPublicaSocio } from "@/lib/qr";
import { obtenerOGenerarQrFamilia } from "@/lib/socios/qr-familia";
import { determinarTipoCorreo } from "@/lib/socios/tipo-correo";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";

export type ResultadoEnvioQr =
  | { ok: true; enviado: true; via: "reenvio_manual" | "idempotente" }
  | { ok: true; enviado: false; motivo: "ya_enviado" | "busy_otro_proceso" }
  | { ok: false; error: string };

// Compat: tira en error (callers viejos como registrarReenvioEmail usan
// try/catch). Reenvio manual, no idempotente.
export async function enviarCorreoQrSocio(
  solicitudId: string,
  opts: { soloSiNoEnviado?: boolean } = {}
): Promise<ResultadoEnvioQr> {
  const soloSiNoEnviado = opts.soloSiNoEnviado === true;
  if (soloSiNoEnviado) {
    // Legacy: construye admin internamente. Nuevas rutas deben llamar
    // enviarCorreoQrSocioIdempotente(admin, ...) directamente.
    const admin = createSupabaseAdminClient();
    return await enviarCorreoQrSocioIdempotente(admin, solicitudId);
  }
  await enviarForzado(solicitudId);
  return { ok: true, enviado: true, via: "reenvio_manual" };
}

// Flujo idempotente admin-driven. El webhook y reconciliar-pago llaman
// a esta funcion pasando su admin (SupabaseClient con service_role).
// Esto permite tests sin cookies de servidor.
export async function enviarCorreoQrSocioIdempotente(
  admin: SupabaseClient,
  solicitudId: string
): Promise<ResultadoEnvioQr> {
  const lockToken = randomUUID();

  const { data: claimData, error: claimErr } = await admin.rpc(
    "claim_email_envio_lock",
    { p_solicitud_id: solicitudId, p_lock_token: lockToken }
  );
  if (claimErr) return { ok: false, error: `claim RPC fallo: ${claimErr.message}` };
  const claim = String(claimData);

  if (claim === "ya_enviado")
    return { ok: true, enviado: false, motivo: "ya_enviado" };
  if (claim === "busy")
    return { ok: true, enviado: false, motivo: "busy_otro_proceso" };
  if (claim === "solicitud_no_encontrada")
    return { ok: false, error: "solicitud no encontrada" };
  if (claim !== "acquired")
    return { ok: false, error: `claim devolvio valor inesperado: ${claim}` };

  try {
    const [{ data: solData, error: solErr }, { data: cfgData }] = await Promise.all([
      admin.from("socio_solicitudes").select("*").eq("id", solicitudId).maybeSingle(),
      admin.from("socio_config").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (solErr) throw new Error(solErr.message);
    if (!solData) throw new Error("Solicitud no encontrada.");
    const s = solData as SocioSolicitud;
    const config = cfgData as SocioConfig | null;

    let qrTokenPublico: string;
    if (s.apoderado_id) {
      qrTokenPublico = await obtenerOGenerarQrFamilia(admin, s.apoderado_id);
    } else {
      qrTokenPublico = s.qr_token;
    }
    const url = urlPublicaSocio(qrTokenPublico);
    const qrDataUrl = await generarQrDataUrl(url, { size: 400 });
    const tipo =
      s.tipo_correo ??
      (await determinarTipoCorreo(admin, s.apoderado_id, s.periodo_anio, s.id));
    const { subject, html } = armarCorreoSocioHtml({
      solicitud: s,
      qrDataUrl,
      qrTokenPublico,
      tipo,
      config,
    });

    await enviarCorreo({ to: s.apoderado_email, subject, html });

    const { error: updErr } = await admin
      .from("socio_solicitudes")
      .update({
        estado: "enviada",
        email_enviado_en: new Date().toISOString(),
        email_envio_lock_at: null,
        email_envio_lock_token: null,
      })
      .eq("id", solicitudId);
    if (updErr) {
      console.error(
        "[enviar-qr] correo enviado pero fallo UPDATE post-send:",
        updErr.message
      );
    }
    return { ok: true, enviado: true, via: "idempotente" };
  } catch (err) {
    await admin.rpc("liberar_email_envio_lock", {
      p_solicitud_id: solicitudId,
      p_lock_token: lockToken,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Flujo compat / reenvio manual. SIEMPRE envia. Incrementa email_reenvios
// si ya habia enviado antes. Usa supabase cliente server (requiere cookies).
async function enviarForzado(solicitudId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const [{ data: solData, error: solErr }, { data: cfgData }] = await Promise.all([
    supabase.from("socio_solicitudes").select("*").eq("id", solicitudId).maybeSingle(),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (solErr) throw new Error(solErr.message);
  if (!solData) throw new Error("Solicitud no encontrada.");
  const s = solData as SocioSolicitud;
  const config = cfgData as SocioConfig | null;

  let qrTokenPublico: string;
  if (s.apoderado_id) {
    qrTokenPublico = await obtenerOGenerarQrFamilia(supabase, s.apoderado_id);
  } else {
    qrTokenPublico = s.qr_token;
  }
  const url = urlPublicaSocio(qrTokenPublico);
  const qrDataUrl = await generarQrDataUrl(url, { size: 400 });
  const tipo =
    s.tipo_correo ??
    (await determinarTipoCorreo(supabase, s.apoderado_id, s.periodo_anio, s.id));
  const { subject, html } = armarCorreoSocioHtml({
    solicitud: s,
    qrDataUrl,
    qrTokenPublico,
    tipo,
    config,
  });

  await enviarCorreo({ to: s.apoderado_email, subject, html });

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

  if (s.apoderado_id) {
    await supabase
      .from("apoderados")
      .update({ socio: true, socio_periodo: s.periodo_anio })
      .eq("id", s.apoderado_id);
  }
}
