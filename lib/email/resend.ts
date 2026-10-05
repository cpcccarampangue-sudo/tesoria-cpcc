// Cliente Resend compartido por los modulos que envian correos
// transaccionales (socios por ahora; futuro: notificaciones de directiva).
//
// Env vars requeridas:
//   RESEND_API_KEY               (crear en https://resend.com/api-keys)
//   RESEND_FROM                  (ej: "Tesoreria CPCC <noreply@centropadrescarampangue.cl>")
//                                Si no esta seteada, usa "onboarding@resend.dev"
//                                (util para pruebas iniciales).
//   RESEND_REPLY_TO              (opcional, ej: tesoreria@centropadrescarampangue.cl)

import { Resend } from "resend";

let _client: Resend | null = null;

function client(): Resend {
  if (!_client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error(
        "El envío de correo no está configurado todavía (falta RESEND_API_KEY en Vercel). Mientras tanto, comparte el link público del QR manualmente con el apoderado."
      );
    }
    _client = new Resend(key);
  }
  return _client;
}

export function resendHabilitado(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function from(): string {
  return process.env.RESEND_FROM ?? "Tesoreria CPCC <onboarding@resend.dev>";
}

function replyTo(): string | undefined {
  return process.env.RESEND_REPLY_TO || undefined;
}

export type EnviarCorreoInput = {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
  }>;
};

export async function enviarCorreo(input: EnviarCorreoInput): Promise<void> {
  const c = client();
  const payload = {
    from: from(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(replyTo() ? { replyTo: replyTo() } : {}),
    ...(input.attachments
      ? {
          attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
          })),
        }
      : {}),
  };
  const { error } = await c.emails.send(payload);
  if (error) {
    // Mensajes claros para los errores mas comunes de Resend.
    const msg = error.message ?? "";
    const nombre = (error as unknown as { name?: string }).name ?? "";

    // Sandbox: con onboarding@resend.dev solo se puede enviar al email
    // registrado en la cuenta de Resend.
    if (
      msg.includes("You can only send testing emails") ||
      msg.includes("verified") ||
      nombre === "validation_error"
    ) {
      throw new Error(
        `Resend rechazó el envío a "${input.to}". Con el remitente de prueba ("onboarding@resend.dev") solo se puede enviar al correo que creó la cuenta Resend (cpcc.carampangue@gmail.com). Para enviar a otros apoderados, verifica tu dominio en Resend y cambia RESEND_FROM en Vercel.`
      );
    }

    if (msg.toLowerCase().includes("api key") || nombre === "unauthorized") {
      throw new Error(
        `La API key de Resend no es válida o no tiene permisos. Revisa RESEND_API_KEY en Vercel.`
      );
    }

    throw new Error(`Resend: ${msg || "error desconocido"}`);
  }
}
