// Generador de QR codes compartido por el modulo de socios.
// Devuelve data URL (base64) para embeber inline en correos y UI.

import QRCode from "qrcode";

export type QrOptions = {
  size?: number;
  margin?: number;
};

export async function generarQrDataUrl(
  texto: string,
  opts: QrOptions = {}
): Promise<string> {
  return await QRCode.toDataURL(texto, {
    width: opts.size ?? 400,
    margin: opts.margin ?? 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#0f172a", // slate-900
      light: "#ffffff",
    },
  });
}

// Devuelve el QR como PNG buffer (para adjuntar al correo en vez de inline).
export async function generarQrBuffer(
  texto: string,
  opts: QrOptions = {}
): Promise<Buffer> {
  return await QRCode.toBuffer(texto, {
    width: opts.size ?? 400,
    margin: opts.margin ?? 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });
}

// URL base del sitio para construir el link que codifica el QR.
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://tesoria-cpcc.vercel.app"
  ).replace(/\/+$/, "");
}

export function urlPublicaSocio(qrToken: string): string {
  return `${siteUrl()}/socio/${qrToken}`;
}
