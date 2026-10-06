// Cliente SMTP para correo transaccional. Usa Gmail del CdP como
// servidor (smtp.gmail.com) con una "contrasena de aplicacion" de
// Google. Pensado para volumen bajo-medio (OTPs + confirmaciones
// de incorporacion). Para campanas masivas (>500/dia) migrar a un
// proveedor como Resend.
//
// Env vars requeridas:
//   GMAIL_USER            Correo de la cuenta Gmail del CdP (ej.
//                         centropadres.colegiocarampangue@gmail.com).
//   GMAIL_APP_PASSWORD    Contrasena de aplicacion generada en
//                         myaccount.google.com -> Seguridad.
//                         16 caracteres. Puede venir con o sin
//                         espacios (los limpiamos).
//
// Env vars opcionales:
//   GMAIL_FROM_NAME       Nombre visible del remitente. Default:
//                         "Centro de Padres Colegio Carampangue".
//   GMAIL_REPLY_TO        Correo para respuestas (si distinto al
//                         remitente, ej. tesoreria@...).

import nodemailer, { type Transporter } from "nodemailer";

let _transporter: Transporter | null = null;

function user(): string {
  const u = process.env.GMAIL_USER;
  if (!u) {
    throw new Error(
      "El envío de correo no está configurado todavía (falta GMAIL_USER en Vercel)."
    );
  }
  return u;
}

function pass(): string {
  const raw = process.env.GMAIL_APP_PASSWORD;
  if (!raw) {
    throw new Error(
      "El envío de correo no está configurado todavía (falta GMAIL_APP_PASSWORD en Vercel)."
    );
  }
  // Las app passwords de Google se muestran con espacios ("abcd efgh ...");
  // tolerar ambas formas.
  return raw.replace(/\s+/g, "");
}

function transporter(): Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: user(),
        pass: pass(),
      },
    });
  }
  return _transporter;
}

export function emailHabilitado(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function fromHeader(): string {
  const nombre = process.env.GMAIL_FROM_NAME ?? "Centro de Padres Colegio Carampangue";
  return `${nombre} <${user()}>`;
}

function replyTo(): string | undefined {
  return process.env.GMAIL_REPLY_TO || undefined;
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
  const t = transporter();
  try {
    await t.sendMail({
      from: fromHeader(),
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
    });
  } catch (err) {
    // Mensajes claros para los casos mas comunes.
    const msg = err instanceof Error ? err.message : "";
    const code = (err as { code?: string } | null)?.code ?? "";

    if (code === "EAUTH" || /Username and Password not accepted|BadCredentials/i.test(msg)) {
      throw new Error(
        `Gmail rechazó las credenciales. Verifica GMAIL_USER y GMAIL_APP_PASSWORD en Vercel (la contraseña debe ser una "contraseña de aplicación" de Google, no la del correo).`
      );
    }
    if (code === "EENVELOPE" || /Invalid.*recipient/i.test(msg)) {
      throw new Error(
        `El correo del destinatario "${input.to}" no fue aceptado por Gmail.`
      );
    }
    if (/550.*daily sending quota|Daily user sending/i.test(msg)) {
      throw new Error(
        `Gmail bloqueó el envío por superar el límite diario (~500/día). Vuelve a intentar mañana o migra a un proveedor transaccional.`
      );
    }
    throw new Error(`Gmail: ${msg || "error desconocido"}`);
  }
}
