// Endpoint TEMPORAL admin-only para reenviar el correo de una solicitud
// ya pagada. Pensado para probar cambios de template/QR sin tocar pago.
//
// POST /api/debug/reenviar-correo
// Body: { checkout_id: text } o { solicitud_id: uuid }
//
// Reutiliza enviarCorreoQrSocio (modo compat / reenvio manual). Efectos:
//   - Envia SMTP con QR via CID.
//   - UPDATE socio_solicitudes: email_enviado_en = NOW() + email_reenvios + 1.
//   - UPDATE apoderados: socio = true, socio_periodo = periodo_anio (idempotente).
//
// NO toca:
//   - SumUp (ni GET live ni POST crear checkout).
//   - movimientos (no inserta ni actualiza).
//   - pagada_en.
//   - sumup_transaction_id / sumup_transaction_code.
//   - apoderados.qr_token (si ya existe, lo reutiliza; no se regenera).
//   - estado 'pagada' NO retrocede; queda 'enviada' tras el envio.
//   - No invoca reconciliar_pago_socio_core ni reconciliarPagoSocio.

import { NextResponse, type NextRequest } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";

export const dynamic = "force-dynamic";

function maskEmail(e: string | null | undefined): string {
  if (!e) return "<null>";
  const at = e.indexOf("@");
  if (at < 1) return "***";
  return (
    (e[0] ?? "*") +
    "***@" +
    (e[at + 1] ?? "*") +
    "***"
  );
}

export async function POST(req: NextRequest) {
  try {
    await requireDirectiva();

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const b = body as {
      solicitud_id?: string;
      checkout_id?: string;
      email_destino?: string;
    };
    const solicitudIdParam =
      typeof b.solicitud_id === "string" ? b.solicitud_id : null;
    const checkoutIdParam =
      typeof b.checkout_id === "string" ? b.checkout_id : null;
    const emailDestinoRaw =
      typeof b.email_destino === "string" && b.email_destino.trim() !== ""
        ? b.email_destino
        : null;
    if (!solicitudIdParam && !checkoutIdParam) {
      return NextResponse.json(
        {
          ok: false,
          error: "body requiere { solicitud_id: uuid } o { checkout_id: text }",
        },
        { status: 400 }
      );
    }
    // Validacion server-side del email alternativo si viene.
    let emailDestinoLimpio: string | null = null;
    if (emailDestinoRaw != null) {
      const e = emailDestinoRaw.trim().toLowerCase();
      if (!e || e.length > 254) {
        return NextResponse.json(
          { ok: false, error: "email_destino vacio o demasiado largo" },
          { status: 400 }
        );
      }
      if (/[\r\n\0\t ,;]/.test(e)) {
        return NextResponse.json(
          { ok: false, error: "email_destino contiene caracteres no permitidos" },
          { status: 400 }
        );
      }
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) {
        return NextResponse.json(
          { ok: false, error: "email_destino formato invalido" },
          { status: 400 }
        );
      }
      emailDestinoLimpio = e;
    }

    const admin = createSupabaseAdminClient();
    const q = admin
      .from("socio_solicitudes")
      .select("id, estado, apoderado_email");
    const { data: solData } = solicitudIdParam
      ? await q.eq("id", solicitudIdParam).maybeSingle()
      : await q.eq("sumup_checkout_id", checkoutIdParam as string).maybeSingle();
    const sol = solData as {
      id: string;
      estado: string;
      apoderado_email: string;
    } | null;
    if (!sol) {
      return NextResponse.json(
        { ok: false, error: "solicitud no encontrada" },
        { status: 404 }
      );
    }
    if (sol.estado !== "pagada" && sol.estado !== "enviada") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "solo se reenvia correo si la solicitud ya esta pagada o enviada",
          estado_actual: sol.estado,
        },
        { status: 409 }
      );
    }

    // Reenvio compat (siempre envia). NO toca SumUp.
    const r = await enviarCorreoQrSocio(sol.id, {
      emailDestino: emailDestinoLimpio,
    });
    const destinatarioFinal = emailDestinoLimpio ?? sol.apoderado_email;
    return NextResponse.json({
      ok: true,
      enviado: true,
      destinatario_mask: maskEmail(destinatarioFinal),
      uso_email_alternativo: emailDestinoLimpio !== null,
      detalle: r,
      efectos: [
        "UPDATE socio_solicitudes.email_enviado_en = NOW()",
        "UPDATE socio_solicitudes.email_reenvios + 1",
        "UPDATE apoderados.socio=true, socio_periodo (idempotente)",
      ],
      no_toco: [
        "SumUp (ni GET live ni POST)",
        "movimientos",
        "socio_solicitudes.pagada_en",
        "socio_solicitudes.sumup_transaction_id/code",
        "apoderados.qr_token (reutilizado si existia)",
      ],
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(
      "[reenviar-correo] error",
      JSON.stringify({ code: e.code ?? null, message: e.message ?? "" })
    );
    return NextResponse.json(
      { ok: false, error: e.message ?? String(err) },
      { status: 500 }
    );
  }
}
