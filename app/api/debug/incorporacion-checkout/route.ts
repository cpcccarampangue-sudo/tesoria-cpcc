// Endpoint TEMPORAL de diagnostico para /incorporacion/pago.
// Protegido con requireDirectiva. Lee UNA solicitud existente por
// qr_token (no la modifica), reproduce el POST /v0.1/checkouts con los
// MISMOS valores que usa resolverUrlCheckout, y devuelve:
//   - request body enviado a SumUp (sin API key)
//   - response de SumUp: status + body sanitizado
//   - sumup_checkout_id actual de la solicitud (si quedo NULL o algun ID)
//
// NO toca la solicitud, NO guarda sumup_checkout_id, NO crea otra solicitud,
// NO envia correo, NO toca QR ni socio_periodo. Si crearCheckout tiene exito,
// el checkout queda huerfano en SumUp pero no se persiste en nuestra DB.
//
// Uso: GET /api/debug/incorporacion-checkout?token=<qr_token>
// Eliminar cuando el bug este diagnosticado.

import { NextResponse } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/qr";
import type { SocioSolicitud } from "@/lib/types";

export const dynamic = "force-dynamic";

const API_BASE = "https://api.sumup.com/v0.1";

function sanitize(text: string): string {
  const t = text.trim();
  if (t.length === 0) return "<empty>";
  return t.length > 1000 ? t.slice(0, 1000) + "…" : t;
}

function webhookNotificationUrl(): string {
  const explicit = process.env.SUMUP_WEBHOOK_URL;
  if (explicit) return explicit;
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://tesoria-cpcc.vercel.app";
  return `${site.replace(/\/$/, "")}/api/webhooks/sumup`;
}

export async function GET(req: Request) {
  await requireDirectiva();

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Falta ?token=<qr_token>" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: solData, error: solErr } = await admin
    .from("socio_solicitudes")
    .select("*")
    .eq("qr_token", token)
    .maybeSingle();
  if (solErr) {
    return NextResponse.json(
      { ok: false, step: "select_solicitud", error: solErr.message },
      { status: 500 }
    );
  }
  if (!solData) {
    return NextResponse.json(
      { ok: false, error: "Solicitud no encontrada para ese token." },
      { status: 404 }
    );
  }
  const solicitud = solData as SocioSolicitud;

  // Snapshot del estado actual de la solicitud (antes de intentar nada).
  const solicitudSnapshot = {
    id: solicitud.id,
    qr_token: solicitud.qr_token,
    estado: solicitud.estado,
    periodo_anio: solicitud.periodo_anio,
    monto_cuota: solicitud.monto_cuota,
    sumup_checkout_id_actual: solicitud.sumup_checkout_id,
    apoderado_email: solicitud.apoderado_email,
    apoderado_nombre: solicitud.apoderado_nombre,
    created_at: solicitud.created_at,
  };

  const apiKey = process.env.SUMUP_API_KEY;
  const merchantCode = process.env.SUMUP_MERCHANT_CODE;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        step: "env",
        error: "SUMUP_API_KEY no esta seteada en el env de produccion.",
        solicitud: solicitudSnapshot,
      },
      { status: 500 }
    );
  }
  if (!merchantCode) {
    return NextResponse.json(
      {
        ok: false,
        step: "env",
        error: "SUMUP_MERCHANT_CODE no esta seteada.",
        solicitud: solicitudSnapshot,
      },
      { status: 500 }
    );
  }

  // Reproducimos EL MISMO body que arma lib/sumup/client.crearCheckout()
  // llamado desde pago/page.tsx::resolverUrlCheckout.
  const checkout_reference = `socio_${solicitud.id}`;
  const body: Record<string, unknown> = {
    checkout_reference,
    amount: solicitud.monto_cuota,
    currency: "CLP",
    merchant_code: merchantCode,
    description: `Cuota socio CdP ${solicitud.periodo_anio} - ${solicitud.apoderado_nombre}`,
    return_url: webhookNotificationUrl(),
    pay_to_email: solicitud.apoderado_email,
    personal_details: { first_name: solicitud.apoderado_nombre },
    hosted_checkout: { enabled: true },
    redirect_url: `${siteUrl()}/incorporacion/pago?token=${solicitud.qr_token}`,
  };

  // Request/body se devuelven en el JSON para transparencia total.
  const requestEnviado = {
    url: `${API_BASE}/checkouts`,
    method: "POST",
    body,
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        step: "fetch_sumup",
        error:
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err),
        solicitud: solicitudSnapshot,
        request_enviado: requestEnviado,
      },
      { status: 502 }
    );
  }

  const bodyText = await res.text();

  // Response parseado (si JSON).
  let bodyParsed: unknown = null;
  try {
    bodyParsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyParsed = null;
  }

  // En caso de error, extraemos el detalle como lo haria el helper real.
  let detail: string | undefined;
  if (!res.ok && bodyParsed && typeof bodyParsed === "object") {
    const o = bodyParsed as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === "string") parts.push(o.message);
    if (typeof o.detail === "string") parts.push(o.detail);
    if (typeof o.error_code === "string") parts.push(`code=${o.error_code}`);
    if (typeof o.title === "string") parts.push(o.title);
    detail = parts.join(" | ") || undefined;
  }

  return NextResponse.json({
    ok: res.ok,
    sumup_response: {
      status_code: res.status,
      status_text: res.statusText,
      body_raw: sanitize(bodyText),
      body_parsed: bodyParsed,
      detail_legible: detail,
    },
    request_enviado: requestEnviado,
    solicitud: solicitudSnapshot,
    nota:
      "Este endpoint NO modifico la solicitud. sumup_checkout_id_actual sigue como estaba. " +
      "Si ok=true, se creo un checkout huerfano en SumUp (no persistido localmente).",
  });
}
