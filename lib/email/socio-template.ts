// Templates HTML del correo que recibe el apoderado tras pagar o
// renovar la membresia. Dos variantes:
//   - "bienvenida"  -> primera vez que la familia paga la cuota.
//   - "renovacion"  -> ya pago en algun periodo anterior.
//
// Diseño responsivo, compatible con Gmail/Outlook/Apple Mail (tablas).
// Los botones de Convenios / Instagram / WhatsApp se renderizan solo
// si la URL correspondiente esta en env vars (NUNCA inventar URLs).

import type { SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { siteUrl, urlPublicaSocio } from "@/lib/qr";
import { linksSociales } from "@/lib/socios/links";

export type TipoCorreoSocio = "bienvenida" | "renovacion";

type Args = {
  solicitud: SocioSolicitud;
  qrDataUrl: string;
  qrTokenPublico: string;
  tipo: TipoCorreoSocio;
};

export function armarCorreoSocioHtml(
  solicitudOrArgs: SocioSolicitud | Args,
  qrDataUrlLegacy?: string,
  qrTokenPublicoLegacy?: string
): { subject: string; html: string } {
  // Compat: callers viejos pasan (solicitud, qrDataUrl, qrTokenPublico?).
  // Callers nuevos pasan ({ solicitud, qrDataUrl, qrTokenPublico, tipo }).
  const args: Args =
    "qrDataUrl" in (solicitudOrArgs as object) &&
    (solicitudOrArgs as Args).qrDataUrl
      ? (solicitudOrArgs as Args)
      : {
          solicitud: solicitudOrArgs as SocioSolicitud,
          qrDataUrl: qrDataUrlLegacy ?? "",
          qrTokenPublico:
            qrTokenPublicoLegacy ?? (solicitudOrArgs as SocioSolicitud).qr_token,
          tipo: "bienvenida",
        };

  const { solicitud, qrDataUrl, qrTokenPublico, tipo } = args;
  const url = urlPublicaSocio(qrTokenPublico);
  const base = siteUrl();
  const anio = solicitud.periodo_anio;

  const subject =
    tipo === "renovacion"
      ? `¡Gracias por renovar tu membresía CPCC ${anio}! 💙`
      : `¡Bienvenidos como socios CPCC ${anio}! 💙`;

  const saludo =
    tipo === "renovacion"
      ? `¡Gracias por renovar tu membresía del Centro de Padres para <strong>${anio}</strong>!`
      : `¡Bienvenidos al Centro de Padres del Colegio Carampangue!`;

  const bodyIntro =
    tipo === "renovacion"
      ? `Tu renovación fue confirmada correctamente y tu membresía ya se encuentra vigente para el nuevo período.
         <br/><br/>
         <strong>Tu QR de socio continúa siendo válido.</strong>
         Te lo enviamos nuevamente para que puedas guardarlo y utilizarlo al acceder a nuestros convenios y beneficios.`
      : `Tu incorporación como <strong>socio CPCC ${anio}</strong> fue confirmada correctamente.
         <br/><br/>
         A continuación encontrarás tu <strong>QR de socio</strong>, que podrás utilizar para acreditar tu membresía y acceder a los beneficios y convenios disponibles para nuestros socios.
         <br/><br/>
         <strong>Guarda este QR</strong>, ya que será tu identificación como socio para futuros períodos. Al renovar cada año, este mismo QR podrá continuar utilizándose.`;

  const cierre =
    tipo === "renovacion"
      ? `Muchas gracias por seguir siendo parte de nuestra comunidad.`
      : `Gracias por ser parte del Centro de Padres y apoyar las iniciativas para nuestra comunidad escolar.`;

  const botonesHtml = renderBotonesSociales();

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <tr><td style="padding:24px;text-align:center;background:#0f172a;color:#ffffff;">
          <h1 style="margin:0 0 4px;font-size:18px;font-weight:600;letter-spacing:0.02em;">${esc(INSTITUCION_NOMBRE)}</h1>
          <div style="font-size:12px;color:#94a3b8;">Colegio Carampangue</div>
        </td></tr>

        <tr><td style="padding:24px 24px 8px;">
          <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#0f172a;">
            Hola <strong>${esc(solicitud.apoderado_nombre)}</strong>,
          </p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#0f172a;">
            ${saludo}
          </p>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">
            ${bodyIntro}
          </p>
        </td></tr>

        <tr><td style="padding:16px 24px;text-align:center;">
          <div style="display:inline-block;padding:16px;background:#f1f5f9;border-radius:8px;">
            <img src="${qrDataUrl}" alt="Código QR de socio" width="240" height="240" style="display:block;width:240px;height:240px;" />
          </div>
          <div style="margin-top:8px;font-size:11px;color:#94a3b8;">
            También puedes acceder desde: <a href="${esc(url)}" style="color:#64748b;">${esc(url)}</a>
          </div>
        </td></tr>

        <tr><td style="padding:12px 24px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#64748b;width:35%;border-bottom:1px solid #e2e8f0;">Familia</td>
              <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${esc(solicitud.apoderado_nombre)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;border-bottom:1px solid #e2e8f0;">Alumno</td>
              <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${esc(solicitud.alumno_nombre)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;border-bottom:1px solid #e2e8f0;">Curso</td>
              <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${esc(solicitud.curso)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;">Período</td>
              <td style="padding:8px 0;font-weight:500;">Socio ${anio}</td>
            </tr>
          </table>
        </td></tr>

        ${botonesHtml}

        <tr><td style="padding:16px 24px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">${cierre}</p>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#0f172a;font-weight:600;">
            Centro de Padres Colegio Carampangue
          </p>
        </td></tr>

        <tr><td style="padding:16px 24px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;">
            Si perdiste tu QR o necesitas una copia, contacta a la
            tesorería del Centro de Padres y te lo reenviaremos.
          </p>
          <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
            Este correo se envió automáticamente. Por favor no respondas
            directamente a este mensaje. · <a href="${esc(base)}" style="color:#94a3b8;">${esc(base)}</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

function renderBotonesSociales(): string {
  const l = linksSociales();
  const botones: string[] = [];
  if (l.convenios) {
    botones.push(botonHtml(l.convenios, "Ver convenios", "#1d4ed8"));
  }
  if (l.instagram) {
    botones.push(botonHtml(l.instagram, "Instagram CPCC", "#be185d"));
  }
  if (l.whatsapp) {
    botones.push(botonHtml(l.whatsapp, "WhatsApp CPCC", "#16a34a"));
  }
  if (botones.length === 0) return "";
  return `
    <tr><td style="padding:12px 24px 4px;text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>${botones.map((b) => `<td style="padding:6px;">${b}</td>`).join("")}</tr>
      </table>
    </td></tr>`;
}

function botonHtml(href: string, label: string, bg: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:10px 16px;background:${bg};color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
