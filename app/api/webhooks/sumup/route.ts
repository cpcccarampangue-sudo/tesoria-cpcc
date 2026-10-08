// Webhook de SumUp Online Payments.
//
// SumUp notifica cambios de estado del checkout (CHECKOUT_STATUS_CHANGED).
// Al confirmarse un pago (PAID), marcamos la solicitud como pagada,
// guardamos transaction_id y disparamos el envio del QR por correo.
//
// Configurar URL del webhook en SumUp dashboard apuntando a:
//   https://tesoreria.centropadrescarampangue.cl/api/webhooks/sumup
//
// Firma HMAC: OPCIONAL. SumUp Online Payments no exige firma por default.
// Si viene (en X-Payload-Signature o X-Sumup-Signature) y es valida con
// SUMUP_WEBHOOK_SECRET, la aceptamos como defensa adicional. Si viene y
// es invalida, rechazamos 401. Si no viene, procesamos igual: la fuente
// de verdad es GET /v0.1/checkouts/{id} con nuestra SUMUP_API_KEY
// (ningun atacante puede forzar un PAID falso sin pagar en SumUp real).

import { NextResponse, type NextRequest } from "next/server";
import {
  verificarFirmaWebhook,
  obtenerCheckout,
  type CheckoutResp,
} from "@/lib/sumup/client";
import { handleE2ETest } from "@/lib/sumup/e2e-handler";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reconciliarPagoSocio } from "@/lib/socios/reconciliar-pago";
import type { SocioSolicitud } from "@/lib/types";

export const dynamic = "force-dynamic";

// Solo nos interesa este event_type (unico de Online Payments relevante
// para checkouts). Otros eventos de SumUp (merchant updates, etc.) se
// ignoran con 2xx.
const EVENT_RELEVANTE = "CHECKOUT_STATUS_CHANGED";

// Headers de firma que SumUp documenta/ha usado. Si algun dia agregan
// uno nuevo, lo incluimos aqui sin cambiar la logica.
const HEADERS_FIRMA = ["x-payload-signature", "x-sumup-signature"];

type MinimalPayload = {
  event_type?: string;
  id?: string;
  // Algunos eventos tambien traen payload.checkout_id; lo consideramos
  // como ultimo fallback para extraer el id. No parseamos nada mas del
  // payload: la fuente de verdad es el GET live.
  payload?: { checkout_id?: string };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // 1) Firma OPCIONAL. Solo valida si viene algun header reconocido.
  let firmaHeaderNombre: string | null = null;
  let firmaHeaderValor: string | null = null;
  for (const h of HEADERS_FIRMA) {
    const v = req.headers.get(h);
    if (v) {
      firmaHeaderNombre = h;
      firmaHeaderValor = v;
      break;
    }
  }
  if (firmaHeaderValor) {
    const firmaValida = await verificarFirmaWebhook(rawBody, firmaHeaderValor);
    if (!firmaValida) {
      console.warn("[webhook SumUp] firma presente pero invalida; header=" + firmaHeaderNombre);
      return NextResponse.json({ error: "firma invalida" }, { status: 401 });
    }
  }

  // 2) Parseo minimo. Si el body no es JSON, 400.
  let event: MinimalPayload;
  try {
    event = JSON.parse(rawBody) as MinimalPayload;
  } catch {
    return NextResponse.json({ error: "body invalido" }, { status: 400 });
  }

  const eventType = event.event_type ?? null;
  const checkoutId =
    (typeof event.id === "string" ? event.id : null) ??
    event.payload?.checkout_id ??
    null;

  // 3) Log seguro (sin PII): solo campos tecnicos del evento.
  const logBase = {
    event_type: eventType,
    checkout_id: checkoutId ? checkoutId.slice(0, 8) + "…" : null,
    firma_header_recibido: firmaHeaderNombre,
    firma_valida: firmaHeaderValor ? true : null, // true si pasó validación arriba
  };
  console.info("[webhook SumUp] in:", JSON.stringify(logBase));

  // 4) event_type desconocido → 2xx sin hacer nada (SumUp no reintentara).
  if (eventType && eventType !== EVENT_RELEVANTE) {
    console.info(
      "[webhook SumUp] event_type ignorado:",
      eventType
    );
    return NextResponse.json({
      ok: true,
      note: `event_type ${eventType} ignorado`,
    });
  }

  // 5) Sin checkout_id no hay nada que hacer. 2xx para no reintentar.
  if (!checkoutId) {
    console.warn("[webhook SumUp] evento sin checkout id, ignorado");
    return NextResponse.json({ ok: true, note: "sin checkout id" });
  }

  // 6) GET live al checkout — fuente de verdad.
  let live: CheckoutResp;
  try {
    live = await obtenerCheckout(checkoutId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhook SumUp] obtenerCheckout fallo:", msg);
    // 502: no retomamos como "no procesado"; devolvemos error para que
    // SumUp pueda reintentar y nos autoreparemos cuando SumUp responda.
    return NextResponse.json(
      { error: "no se pudo revalidar checkout en SumUp", detail: msg },
      { status: 502 }
    );
  }

  // 7) Validar merchant: el checkout debe pertenecer a NUESTRO merchant.
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE;
  if (
    expectedMerchant &&
    live.merchant_code &&
    live.merchant_code !== expectedMerchant
  ) {
    console.error("[webhook SumUp] merchant_code no coincide, ignorado");
    return NextResponse.json(
      { error: "merchant_code mismatch" },
      { status: 409 }
    );
  }

  const refLive = live.checkout_reference ?? null;
  if (!refLive) {
    console.warn("[webhook SumUp] checkout sin reference, ignorado");
    return NextResponse.json({ ok: true, note: "sin reference" });
  }

  // Log del resultado live (sin PII).
  console.info(
    "[webhook SumUp] live:",
    JSON.stringify({
      checkout_id: live.id.slice(0, 8) + "…",
      ref: refLive,
      status: live.status,
      amount: live.amount,
      currency: live.currency,
    })
  );

  // 8) Ruteo por prefijo de reference.
  //    - sumup_e2e_test_* → branch temporal E2E (nunca toca socios).
  //    - socio_<id>       → flujo normal de incorporacion.
  //    - otro             → sin solicitud asociada, 2xx.
  if (refLive.startsWith("sumup_e2e_test_")) {
    // Early return garantizado por diseño: handleE2ETest siempre
    // devuelve NextResponse. Eliminar junto con migracion 029.
    return handleE2ETest(refLive, { event_type: eventType ?? undefined, id: checkoutId, payload: { checkout_id: checkoutId } }, live);
  }

  if (!refLive.startsWith("socio_")) {
    console.info("[webhook SumUp] reference desconocida, ignorada:", refLive);
    return NextResponse.json({ ok: true, note: "reference desconocida" });
  }

  return await procesarSocio(refLive, live);
}

// ================================================================
// Procesamiento del flujo de socios (refLive = "socio_<id>")
// Delega en reconciliarPagoSocio (RPC transaccional + email idempotente).
// ================================================================
async function procesarSocio(
  refLive: string,
  live: CheckoutResp
): Promise<NextResponse> {
  const admin = createSupabaseAdminClient();

  // Extraer UUID de reference. Toleramos socio_<uuid> y socio_<uuid>_r<ts>.
  // Fallback por sumup_checkout_id si parse falla.
  const matchUuid = refLive.match(
    /^socio_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  let solicitudId: string | null = matchUuid ? matchUuid[1] : null;
  if (!solicitudId) {
    const { data: byCheckout } = await admin
      .from("socio_solicitudes")
      .select("id")
      .eq("sumup_checkout_id", live.id)
      .maybeSingle();
    const row = byCheckout as { id: string } | null;
    solicitudId = row?.id ?? null;
  }

  if (!solicitudId) {
    console.warn(
      "[webhook SumUp] socio_solicitud no encontrada para ref:",
      refLive
    );
    return NextResponse.json({ ok: true, note: "sin solicitud asociada" });
  }

  const result = await reconciliarPagoSocio(admin, {
    modo: "por_live",
    solicitudId,
    live,
  });

  console.info(
    "[webhook SumUp] reconciliacion resultado:",
    JSON.stringify({
      resultado: result.resultado,
      solicitud_id_mask: solicitudId.slice(0, 8) + "…",
      ...(result.resultado === "reconciliada" || result.resultado === "ya_reconciliada"
        ? {
            movimiento_creado: result.core.movimiento_creado,
            qr_generado: result.core.qr_generado,
            correo: result.correo,
          }
        : {}),
    })
  );

  switch (result.resultado) {
    case "reconciliada":
    case "ya_reconciliada":
      return NextResponse.json({
        ok: true,
        resultado: result.resultado,
        correo: result.correo,
      });
    case "mismatch":
      return NextResponse.json(
        { error: "mismatch", detalle: result.core.detalle },
        { status: 409 }
      );
    case "no_paid":
      return NextResponse.json({
        ok: true,
        note: `estado ${result.live_status}, no se procesa`,
      });
    case "sumup_no_disponible":
      // 502 para que SumUp reintente el webhook despues.
      return NextResponse.json(
        { error: "no se pudo revalidar checkout en SumUp" },
        { status: 502 }
      );
    case "solicitud_no_encontrada":
      return NextResponse.json({ ok: true, note: "solicitud desaparecida" });
    case "error_rpc":
      // Loguear el detalle (ya enmascarado por reconciliar-pago) y
      // devolver 500 para que SumUp reintente el webhook despues.
      console.error(
        "[webhook SumUp] error_rpc",
        JSON.stringify({
          stage: result.stage,
          code: result.code,
          message: result.message,
          details: result.details,
          hint: result.hint,
        })
      );
      return NextResponse.json(
        { error: "error_rpc", stage: result.stage, code: result.code },
        { status: 500 }
      );
  }
}

// SumUp a veces hace un GET al endpoint para verificar que existe antes
// de empezar a enviar POSTs. Devolvemos 200 para no bloquearlos.
export async function GET() {
  return NextResponse.json({ ok: true, service: "sumup webhook" });
}
