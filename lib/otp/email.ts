// Email transaccional para el codigo OTP de /incorporacion.
//
// El contenido es DELIBERADAMENTE neutro: no revela si el destinatario
// es socio, si tiene familia registrada, ni ningun dato de la base.
// Solo entrega el codigo y una explicacion generica. Esto evita que el
// correo mismo sea un vector de enumeracion si alguien pide OTP a
// correos ajenos.
//
// Reutiliza enviarCorreo() que ya configura el transporte SMTP (Gmail)
// con el From/ReplyTo correctos.

import { enviarCorreo } from "@/lib/email/mailer";
import { OTP_CONFIG } from "./service";

const ANIO = new Date().getFullYear();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function template(codigo: string): string {
  // Codigo con pequena separacion visual para que sea mas facil leerlo.
  const codigoSep = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
  const codigoHtml = escapeHtml(codigoSep);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Código de verificación — Centro de Padres Colegio Carampangue</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 28px 8px 28px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.14em;color:#1e3a8a;text-transform:uppercase;">Centro de Padres</div>
          <div style="font-size:16px;font-weight:600;color:#0f172a;margin-top:2px;">Colegio Carampangue</div>
        </td></tr>
        <tr><td style="padding:16px 28px 4px 28px;">
          <div style="font-size:22px;font-weight:600;color:#0f172a;line-height:1.2;">Código de verificación</div>
          <p style="margin:8px 0 0 0;font-size:14px;color:#475569;line-height:1.5;">
            Ingresa este código para continuar en la plataforma del Centro de Padres.
          </p>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center;">
            <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:0.18em;color:#0f172a;">${codigoHtml}</div>
          </div>
          <p style="margin:14px 0 0 0;font-size:13px;color:#64748b;line-height:1.5;">
            El código es válido durante <strong>${OTP_CONFIG.OTP_TTL_MIN} minutos</strong>. Si no lo utilizas, caduca automáticamente.
          </p>
        </td></tr>
        <tr><td style="padding:0 28px 20px 28px;">
          <div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;color:#64748b;line-height:1.6;">
            Si tú no solicitaste este código, puedes ignorar este mensaje. Nadie puede acceder sin él.
          </div>
        </td></tr>
        <tr><td style="padding:16px 28px 22px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <div style="font-size:11px;color:#94a3b8;line-height:1.5;">
            Centro de Padres Colegio Carampangue · ${ANIO}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function enviarOtpEmail(email: string, codigo: string): Promise<void> {
  await enviarCorreo({
    to: email,
    subject: "Código de verificación — Centro de Padres Colegio Carampangue",
    html: template(codigo),
  });
}
