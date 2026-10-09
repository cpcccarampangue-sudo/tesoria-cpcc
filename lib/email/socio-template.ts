// Templates HTML del correo que recibe el apoderado tras pagar o
// renovar la membresia. Dos variantes:
//   - "bienvenida"  -> primera vez que la familia paga la cuota.
//   - "renovacion"  -> ya pago en algun periodo anterior.
//
// Diseño HTML FIJO (tablas, botones, QR). Solo el asunto y el cuerpo
// textual son configurables desde /socios/config.
//
// Placeholders aceptados en asunto/cuerpo configurables: {{nombre}},
// {{periodo}}, {{monto}}. Se escapan como HTML antes de reemplazar
// (nunca permiten inyeccion). Cualquier otro {{...}} queda literal.

import type { SocioConfig, SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { siteUrl, urlPublicaSocio } from "@/lib/qr";
import { linksSociales } from "@/lib/socios/links";

export type TipoCorreoSocio = "bienvenida" | "renovacion";

type Args = {
  solicitud: SocioSolicitud;
  // qrSrc preferido (puede ser "cid:qr-socio" o un data URL). Si no
  // viene, cae al qrDataUrl (compat). En correos reales SMTP se usa cid;
  // en el preview admin se usa data URL (iframe sandbox).
  qrSrc?: string;
  qrDataUrl?: string;
  qrTokenPublico: string;
  tipo: TipoCorreoSocio;
  // Config para leer links sociales + textos editables. Opcional por
  // compat con callers viejos (si no se pasa, se usa fallback env + defaults).
  config?: SocioConfig | null;
  // Nombre a usar en el saludo "Hola <nombre>,". Si null/vacio, se usa
  // "Hola,". Normalmente el primer nombre del contacto que paga.
  saludoNombre?: string | null;
};

// Textos default (fallback si DB no tiene override).
const DEFAULTS = {
  bienvenida: {
    asunto: "Bienvenido, ya eres parte del CPCC 💙💛",
    cuerpo:
      "Hola {{nombre}},\n\n" +
      "¡Bienvenidos al Centro de Padres del Colegio Carampangue!\n\n" +
      "Tu incorporación como socio CPCC {{periodo}} fue confirmada correctamente.\n\n" +
      "A continuación encontrarás tu QR de socio, que podrás utilizar para acreditar " +
      "tu membresía y acceder a los beneficios y convenios disponibles para nuestros socios.\n\n" +
      "Guarda este QR, ya que será tu identificación como socio para futuros períodos. " +
      "Al renovar cada año, este mismo QR podrá continuar utilizándose.",
    cierre:
      "Gracias por ser parte del Centro de Padres y apoyar las iniciativas para nuestra comunidad escolar.",
  },
  renovacion: {
    asunto: "¡Gracias por renovar tu membresía CPCC {{periodo}}! 💙",
    cuerpo:
      "Hola {{nombre}},\n\n" +
      "¡Gracias por renovar tu membresía del Centro de Padres para {{periodo}}!\n\n" +
      "Tu renovación fue confirmada correctamente y tu membresía ya se encuentra " +
      "vigente para el nuevo período.\n\n" +
      "Tu QR de socio continúa siendo válido. Te lo enviamos nuevamente para que " +
      "puedas guardarlo y utilizarlo al acceder a nuestros convenios y beneficios.",
    cierre: "Muchas gracias por seguir siendo parte de nuestra comunidad.",
  },
};

export function armarCorreoSocioHtml(
  solicitudOrArgs: SocioSolicitud | Args,
  qrDataUrlLegacy?: string,
  qrTokenPublicoLegacy?: string
): { subject: string; html: string } {
  // Compat: callers viejos pasan (solicitud, qrDataUrl, qrTokenPublico?).
  // Callers nuevos pasan ({ solicitud, qrSrc|qrDataUrl, qrTokenPublico, tipo, config?, saludoNombre? }).
  const args: Args =
    typeof solicitudOrArgs === "object" &&
    solicitudOrArgs !== null &&
    ("qrSrc" in solicitudOrArgs || "qrDataUrl" in solicitudOrArgs)
      ? (solicitudOrArgs as Args)
      : {
          solicitud: solicitudOrArgs as SocioSolicitud,
          qrDataUrl: qrDataUrlLegacy ?? "",
          qrTokenPublico:
            qrTokenPublicoLegacy ?? (solicitudOrArgs as SocioSolicitud).qr_token,
          tipo: "bienvenida",
        };

  const { solicitud, qrTokenPublico, tipo, config, saludoNombre } = args;
  const qrSrc = args.qrSrc ?? args.qrDataUrl ?? "";
  const url = urlPublicaSocio(qrTokenPublico);
  const base = siteUrl();
  const anio = solicitud.periodo_anio;

  // Saludo: usar primer nombre si vino en args.saludoNombre. Si no,
  // dejar vacio para que el post-process convierta "Hola ," en "Hola,".
  // NO usamos solicitud.apoderado_nombre porque suele ser el string de
  // apellidos familiares ("Caceres Rodriguez"), que suena raro como saludo.
  const nombreSaludo = (saludoNombre ?? "").trim();

  const vars: Record<string, string> = {
    nombre: nombreSaludo,
    periodo: String(anio),
    monto: `$${solicitud.monto_cuota.toLocaleString("es-CL")}`,
  };

  // Leer asunto/cuerpo de config si estan seteados; fallback a defaults.
  const asuntoTpl =
    tipo === "renovacion"
      ? config?.correo_renovacion_asunto?.trim() || DEFAULTS.renovacion.asunto
      : config?.correo_bienvenida_asunto?.trim() || DEFAULTS.bienvenida.asunto;
  const cuerpoTpl =
    tipo === "renovacion"
      ? config?.correo_renovacion_cuerpo?.trim() || DEFAULTS.renovacion.cuerpo
      : config?.correo_bienvenida_cuerpo?.trim() || DEFAULTS.bienvenida.cuerpo;
  const cierreTxt =
    tipo === "renovacion" ? DEFAULTS.renovacion.cierre : DEFAULTS.bienvenida.cierre;

  const subject = aplicarPlaceholders(asuntoTpl, vars);
  // Si no hay nombre resuelto, limpiar "Hola <espacios>," -> "Hola,".
  // Si placeholder {{nombre}} no estaba precedido de "Hola ", el no-op
  // igual es inofensivo.
  let cuerpoRaw = aplicarPlaceholders(cuerpoTpl, vars);
  if (!nombreSaludo) {
    cuerpoRaw = cuerpoRaw.replace(/\bHola[ \t]+,/g, "Hola,");
  }
  const cuerpoHtml = cuerpoATextoHtml(cuerpoRaw);

  const botonesHtml = renderBotonesSociales(config);

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
          <div style="font-size:14px;line-height:1.6;color:#334155;">${cuerpoHtml}</div>
        </td></tr>

        <tr><td style="padding:16px 24px;text-align:center;">
          <div style="display:inline-block;padding:16px;background:#f1f5f9;border-radius:8px;">
            <img src="${esc(qrSrc)}" alt="Código QR de socio CPCC" width="240" height="240" style="display:block;width:240px;height:240px;border:0;outline:none;" />
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
              <td style="padding:8px 0;color:#64748b;border-bottom:1px solid #e2e8f0;vertical-align:top;">Alumno</td>
              <td style="padding:8px 0;font-weight:500;border-bottom:1px solid #e2e8f0;">${renderAlumnos(solicitud.alumno_nombre)}</td>
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
          <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">${esc(cierreTxt)}</p>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#0f172a;font-weight:600;">
            Centro de Padres Colegio Carampangue
          </p>
        </td></tr>

        <tr><td style="padding:16px 24px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
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

// Reemplaza {{nombre}}, {{periodo}}, {{monto}} con los valores pasados.
// Cualquier otro {{...}} queda literal. Valores escapados como HTML
// solo cuando se insertan en contexto HTML (ver cuerpoATextoHtml).
function aplicarPlaceholders(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(nombre|periodo|monto)\s*\}\}/g, (_, k) => {
    const v = vars[k as keyof typeof vars];
    return v ?? "";
  });
}

// Convierte un texto plano (con placeholders ya reemplazados) en HTML
// seguro: escapa, convierte \n en <br>, respeta parrafos vacios como
// separador doble.
function cuerpoATextoHtml(txt: string): string {
  return txt
    .split(/\n{2,}/)
    .map((parrafo) => `<p style="margin:0 0 12px;">${esc(parrafo).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function renderBotonesSociales(cfg?: SocioConfig | null): string {
  const l = linksSociales(cfg);
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

// Renderiza el campo "Alumno" de la tabla de datos. Si el string viene
// con varios nombres separados por coma (ej. hermanos registrados en la
// misma solicitud), los pone uno debajo del otro usando <br/> (lo mas
// compatible con Gmail/Outlook/Apple Mail). Si viene un solo nombre, se
// renderiza igual que antes.
function renderAlumnos(valor: string | null | undefined): string {
  const txt = (valor ?? "").trim();
  if (!txt) return "";
  const nombres = txt
    .split(/\s*,\s*/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (nombres.length <= 1) return esc(txt);
  return nombres.map(esc).join("<br/>");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
