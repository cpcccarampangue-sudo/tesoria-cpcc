// Endpoint TEMPORAL de diagnostico para /incorporacion/pago.
// Protegido con requireDirectiva. Lee UNA solicitud existente por
// qr_token (no la modifica). SOLO consulta el checkout live en SumUp
// usando el sumup_checkout_id ya guardado — nunca hace POST, nunca
// crea otro checkout. Devuelve el estado live para validar que el fix
// idempotente reutiliza el checkout existente.
//
// NO modifica la solicitud, NO crea checkout, NO envia correo, NO toca
// QR ni socio_periodo, NO usa Payment Link fijo.
//
// Uso: GET /api/debug/incorporacion-checkout?token=<qr_token>
// Eliminar cuando el fix este validado.

import { NextResponse } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { obtenerCheckout, SumUpError } from "@/lib/sumup/client";
import type { SocioSolicitud } from "@/lib/types";

export const dynamic = "force-dynamic";

function maskId(id: string | null | undefined): string {
  if (!id) return "<null>";
  return id.length <= 8 ? "***" : `${id.slice(0, 8)}…`;
}
function maskEmail(e: string | null | undefined): string {
  if (!e) return "<null>";
  const at = e.indexOf("@");
  if (at < 1) return "***";
  const user = e.slice(0, at);
  const dom = e.slice(at + 1);
  const userMask = user.length <= 2 ? "*" : user[0] + "***";
  const dot = dom.lastIndexOf(".");
  const domMask =
    dot > 0 ? dom[0] + "***" + dom.slice(dot) : dom[0] + "***";
  return `${userMask}@${domMask}`;
}
function maskName(n: string | null | undefined): string {
  if (!n) return "<null>";
  return n
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : w[0] + "***"))
    .join(" ");
}
function maskUrlToken(url: string): string {
  return url.replace(/token=([^&]+)/, (_, t) => `token=${maskId(t)}`);
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

  const solicitudSnapshot = {
    id_mask: maskId(solicitud.id),
    qr_token_mask: maskId(solicitud.qr_token),
    estado: solicitud.estado,
    periodo_anio: solicitud.periodo_anio,
    monto_cuota: solicitud.monto_cuota,
    sumup_checkout_id_actual: solicitud.sumup_checkout_id,
    apoderado_email_mask: maskEmail(solicitud.apoderado_email),
    apoderado_nombre_mask: maskName(solicitud.apoderado_nombre),
    created_at: solicitud.created_at,
  };

  if (!solicitud.sumup_checkout_id) {
    return NextResponse.json({
      ok: true,
      modo: "sin_checkout_id",
      solicitud: solicitudSnapshot,
      nota:
        "La solicitud no tiene sumup_checkout_id guardado. No hay checkout live que consultar. " +
        "Al visitar /incorporacion/pago?token=... el flujo idempotente creara uno nuevo con reference base.",
    });
  }

  // GET live del checkout ya asociado. Nunca hacemos POST aqui.
  let live;
  try {
    live = await obtenerCheckout(solicitud.sumup_checkout_id);
  } catch (err) {
    const detail =
      err instanceof SumUpError
        ? {
            status: err.status,
            path: err.path,
            method: err.method,
            message: err.message,
          }
        : { message: err instanceof Error ? err.message : String(err) };
    return NextResponse.json(
      {
        ok: false,
        modo: "get_live_fallido",
        checkout_id_consultado: solicitud.sumup_checkout_id,
        error: detail,
        solicitud: solicitudSnapshot,
      },
      { status: 502 }
    );
  }

  // Validacion de coherencia contra la solicitud (misma que hace
  // resolverUrlCheckout en /incorporacion/pago).
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE ?? null;
  const refOk = (live.checkout_reference ?? "").startsWith(
    `socio_${solicitud.id}`
  );
  const amountOk = Number(live.amount) === Number(solicitud.monto_cuota);
  const currencyOk = live.currency === "CLP";
  const merchantOk =
    !expectedMerchant ||
    !live.merchant_code ||
    live.merchant_code === expectedMerchant;

  // Enmascaramos la reference live por si lleva el UUID.
  const liveRefMasked = live.checkout_reference
    ? live.checkout_reference.replace(
        /^socio_([^_]+)/,
        (_, u: string) => `socio_${maskId(u)}`
      )
    : null;

  const hostedUrl =
    (live.hosted_checkout_url ?? live.checkout_url ?? null) || null;
  const hostedUrlMasked = hostedUrl ? maskUrlToken(hostedUrl) : null;

  return NextResponse.json({
    ok: true,
    modo: "get_live",
    checkout_id_consultado: solicitud.sumup_checkout_id,
    sumup_live: {
      status: live.status,
      checkout_reference_mask: liveRefMasked,
      amount: live.amount,
      currency: live.currency,
      merchant_code: live.merchant_code ?? null,
      hosted_checkout_url_mask: hostedUrlMasked,
    },
    coherencia: {
      refOk,
      amountOk,
      currencyOk,
      merchantOk,
      expected: {
        reference_prefix: `socio_${maskId(solicitud.id)}`,
        amount: solicitud.monto_cuota,
        currency: "CLP",
        merchant_code_env_set: expectedMerchant !== null,
      },
    },
    solicitud: solicitudSnapshot,
    interpretacion:
      live.status === "PENDING" && refOk && amountOk && currencyOk && merchantOk
        ? "OK: el fix idempotente reutilizara este hosted_checkout_url en el proximo render de /incorporacion/pago. No se hara POST duplicado."
        : live.status === "PAID"
        ? "El checkout ya esta pagado en SumUp. UI mostrara 'ya pagada'; webhook debio marcar DB. No se crea otro."
        : "Checkout en estado no reutilizable; el fix creara uno nuevo con reference versionada 'socio_<uuid>_r<ts>'.",
    nota: "Endpoint SOLO-GET. No modifico la solicitud ni creo checkouts.",
  });
}
