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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  verificarFirmaWebhook,
  obtenerCheckout,
  type CheckoutResp,
} from "@/lib/sumup/client";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";
import { handleE2ETest } from "@/lib/sumup/e2e-handler";
import { obtenerOGenerarQrFamilia } from "@/lib/socios/qr-familia";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
// ================================================================
async function procesarSocio(
  refLive: string,
  live: CheckoutResp
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  // Buscar solicitud por el UUID embebido en la reference. La reference
  // puede ser "socio_<uuid>" o "socio_<uuid>_r<timestamp>" (retry al
  // recrear un checkout tras FAILED/EXPIRED/CANCELED). Fallback adicional
  // por sumup_checkout_id si no se puede parsear.
  const matchUuid = refLive.match(
    /^socio_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  const solicitudId = matchUuid ? matchUuid[1] : refLive.replace(/^socio_/, "");
  const { data: byId } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("id", solicitudId)
    .maybeSingle();
  let solicitud = (byId as SocioSolicitud | null) ?? null;
  if (!solicitud) {
    const { data: byCheckout } = await supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("sumup_checkout_id", live.id)
      .maybeSingle();
    solicitud = (byCheckout as SocioSolicitud | null) ?? null;
  }

  if (!solicitud) {
    console.warn(
      "[webhook SumUp] socio_solicitud no encontrada para ref:",
      refLive
    );
    return NextResponse.json({ ok: true, note: "sin solicitud asociada" });
  }

  // Idempotencia.
  if (solicitud.estado === "pagada" || solicitud.estado === "enviada") {
    return NextResponse.json({ ok: true, note: "ya procesada" });
  }

  // Validaciones de integridad contra el live.
  if (live.status !== "PAID") {
    return NextResponse.json({
      ok: true,
      note: `estado ${live.status}, no se procesa`,
    });
  }
  if (live.currency !== "CLP") {
    console.error("[webhook SumUp] moneda no esperada", {
      esperado: "CLP",
      recibido: live.currency,
      solicitud_id: solicitud.id,
    });
    return NextResponse.json({ error: "moneda no coincide" }, { status: 409 });
  }
  if (Number(live.amount) !== Number(solicitud.monto_cuota)) {
    console.error("[webhook SumUp] monto no coincide", {
      esperado: solicitud.monto_cuota,
      recibido: live.amount,
      solicitud_id: solicitud.id,
    });
    return NextResponse.json({ error: "monto no coincide" }, { status: 409 });
  }

  const transaction_id = live.transaction_id ?? null;
  const transaction_code = live.transaction_code ?? null;

  // Crear movimiento en el libro de caja si la config lo permite.
  let movimientoId: string | null = null;
  const { data: cfgData } = await supabase
    .from("socio_config")
    .select("cuenta_sumup_id, categoria_cuota_id")
    .eq("id", 1)
    .maybeSingle();
  const cfg = cfgData as {
    cuenta_sumup_id: string | null;
    categoria_cuota_id: string | null;
  } | null;
  if (cfg?.cuenta_sumup_id) {
    const descripcion = `Cuota socio CdP ${solicitud.periodo_anio} — ${solicitud.apoderado_nombre} (SumUp)`;
    const { data: movData, error: movErr } = await supabase
      .from("movimientos")
      .insert({
        fecha: new Date().toISOString().slice(0, 10),
        tipo: "ingreso",
        monto: solicitud.monto_cuota,
        descripcion,
        categoria_id: cfg.categoria_cuota_id,
        cuenta_id: cfg.cuenta_sumup_id,
      })
      .select("id")
      .single();
    if (movErr) {
      console.error(
        "[webhook SumUp] Error creando movimiento:",
        movErr.message
      );
    } else {
      movimientoId = movData.id as string;
    }
  }

  // Marcar como pagada (idempotente por el if de arriba).
  const { error: updErr } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "pagada",
      pagada_en: new Date().toISOString(),
      sumup_transaction_id: transaction_id,
      sumup_transaction_code: transaction_code,
      movimiento_id: movimientoId,
    })
    .eq("id", solicitud.id);
  if (updErr) {
    return NextResponse.json(
      { error: `actualizando solicitud: ${updErr.message}` },
      { status: 500 }
    );
  }

  // QR permanente por familia: asegurar apoderados.qr_token antes de
  // enviar el correo. Si no tenia QR, se genera y persiste; si ya
  // tenia, se reutiliza. En solicitudes sin apoderado_id (edge, flujo
  // manual que no fue vinculado) no se asigna QR aun — se asignara
  // cuando la directiva vincule la solicitud a una familia.
  if (solicitud.apoderado_id) {
    try {
      const admin = createSupabaseAdminClient();
      await obtenerOGenerarQrFamilia(admin, solicitud.apoderado_id);
    } catch (err) {
      console.error(
        "[webhook SumUp] no se pudo asignar qr_token al apoderado:",
        err instanceof Error ? err.message : String(err)
      );
      // No fallamos: la solicitud ya quedo pagada; el correo intentara
      // enviarse y si no hay qr_token del apoderado, enviar-qr tiene
      // fallback.
    }
  }

  // Disparar envio automatico del QR por correo. Best-effort.
  try {
    await enviarCorreoQrSocio(solicitud.id);
  } catch (err) {
    console.error("Error enviando correo QR tras webhook SumUp:", err);
  }

  console.info(
    "[webhook SumUp] out: PAID procesado",
    JSON.stringify({ solicitud_id: solicitud.id, movimiento_id: movimientoId })
  );
  return NextResponse.json({ ok: true, movimiento_id: movimientoId });
}

// SumUp a veces hace un GET al endpoint para verificar que existe antes
// de empezar a enviar POSTs. Devolvemos 200 para no bloquearlos.
export async function GET() {
  return NextResponse.json({ ok: true, service: "sumup webhook" });
}
