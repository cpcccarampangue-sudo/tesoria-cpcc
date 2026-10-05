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
    throw new Error(`Error enviando correo: ${error.message}`);
  }
}
