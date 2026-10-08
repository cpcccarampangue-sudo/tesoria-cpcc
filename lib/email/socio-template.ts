// Template HTML del correo que recibe el apoderado al completar su
// incorporacion como socio. Diseno minimo, compatible con la mayoria de
// clientes de correo (Gmail, Outlook, Apple Mail).

import type { SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { siteUrl, urlPublicaSocio } from "@/lib/qr";

export function armarCorreoSocioHtml(
  solicitud: SocioSolicitud,
  qrDataUrl: string,
  // qr_token publico (canonico de la familia). Si se omite, cae al de
  // la solicitud por compat con callers antiguos — nuevos callers DEBEN
  // pasarlo explicitamente.
  qrTokenPublico?: string
): { subject: string; html: string } {
  const url = urlPublicaSocio(qrTokenPublico ?? solicitud.qr_token);
  const base = siteUrl();
  const subject = `Tu QR de socio ${solicitud.periodo_anio} — ${INSTITUCION_NOMBRE}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="padding:24px;text-align:center;background:#0f172a;color:#ffffff;">
              <h1 style="margin:0 0 4px;font-size:18px;font-weight:600;letter-spacing:0.02em;">
                ${INSTITUCION_NOMBRE}
              </h1>
              <div style="font-size:12px;color:#94a3b8;">
                Colegio Carampangue · Tesorería
              </div>
            </td>
          </tr>

          <!-- Saludo -->
          <tr>
            <td style="padding:24px 24px 8px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;">
                ¡Bienvenido/a, ${escape(solicitud.apoderado_nombre)}! 🎉
              </h2>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#475569;">
                Tu incorporación como socio del Centro de Padres del
                Colegio Carampangue fue confirmada. Este es tu código QR
                personal de <strong>socio activo ${solicitud.periodo_anio}</strong>.
              </p>
            </td>
          </tr>

          <!-- QR -->
          <tr>
            <td style="padding:16px 24px;text-align:center;">
              <div style="display:inline-block;padding:16px;background:#f1f5f9;border-radius:8px;">
                <img src="${qrDataUrl}" alt="Código QR de socio" width="240" height="240" style="display:block;width:240px;height:240px;" />
              </div>
            </td>
          </tr>

          <!-- Datos -->
          <tr>
            <td style="padding:16px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
                <tr>
                  <td style="padding:8px 0;color:#64748b;width:40%;border-bottom:1px solid #e2e8f0;">Familia</td>
                  <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${escape(solicitud.apoderado_nombre)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#64748b;border-bottom:1px solid #e2e8f0;">Alumno</td>
                  <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${escape(solicitud.alumno_nombre)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#64748b;border-bottom:1px solid #e2e8f0;">Curso</td>
                  <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${escape(solicitud.curso)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#64748b;">Período</td>
                  <td style="padding:8px 0;font-weight:500;">Socio activo ${solicitud.periodo_anio}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Como usarlo -->
          <tr>
            <td style="padding:16px 24px;">
              <div style="padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;color:#1e40af;line-height:1.5;">
                <strong style="display:block;margin-bottom:6px;">¿Cómo usar tu QR?</strong>
                Muéstralo en reuniones del Centro de Padres, en eventos
                organizados por el colegio y en comercios con convenio
                para socios. Al escanearlo con cualquier celular, verifica
                en línea que eres socio activo del año ${solicitud.periodo_anio}.
              </div>
            </td>
          </tr>

          <!-- Enlace web -->
          <tr>
            <td style="padding:8px 24px 16px;text-align:center;">
              <a href="${url}" style="display:inline-block;padding:10px 20px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">
                Ver mi credencial de socio en línea
              </a>
              <div style="margin-top:8px;font-size:11px;color:#94a3b8;">
                También puedes acceder desde: <a href="${url}" style="color:#64748b;">${url}</a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;">
                Si perdiste tu QR o necesitas una copia, contacta a la
                tesorería del Centro de Padres y te lo reenviaremos.
              </p>
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
                Este correo se envió automáticamente. Por favor no
                respondas directamente a este mensaje. ·
                <a href="${base}" style="color:#94a3b8;">${base}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// Escape minimo para prevenir XSS en nombres que vienen del formulario.
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
