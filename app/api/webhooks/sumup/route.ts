// Webhook de SumUp: notifica cuando un checkout cambia de estado.
// Al confirmarse un pago (status "PAID"), marcamos la solicitud como
// pagada, guardamos el transaction_id y disparamos el envio del QR al
// correo del apoderado.
//
// Configurar la URL del webhook en SumUp dashboard apuntando a:
//   https://<dominio>/api/webhooks/sumup
//
// SumUp firma el payload con SUMUP_WEBHOOK_SECRET; verificamos la firma
// antes de procesar.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verificarFirmaWebhook, obtenerCheckout } from "@/lib/sumup/client";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";
import type { SocioSolicitud } from "@/lib/types";

export const dynamic = "force-dynamic";

type WebhookPayload = {
  event_type?: string; // ej: "checkout.paid"
  id?: string; // id del checkout o transaccion
  payload?: {
    checkout_reference?: string;
    checkout_id?: string;
    transaction_id?: string;
    transaction_code?: string;
    status?: string;
  };
};

export async function POST(req: NextRequest) {
  // Leer raw body para verificar firma
  const rawBody = await req.text();
  const firma =
    req.headers.get("x-payload-signature") ??
    req.headers.get("x-sumup-signature");

  const firmaValida = await verificarFirmaWebhook(rawBody, firma);
  if (!firmaValida) {
    return NextResponse.json(
      { error: "firma invalida" },
      { status: 401 }
    );
  }

  let event: WebhookPayload;
  try {
    event = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "body invalido" }, { status: 400 });
  }

  // Extraer el checkout_reference del payload (lo que nosotros definimos
  // al crear el checkout: "socio_<id>")
  const ref =
    event.payload?.checkout_reference ??
    event.payload?.checkout_id ??
    event.id;
  if (!ref) {
    return NextResponse.json(
      { ok: true, note: "evento sin referencia, ignorado" },
      { status: 200 }
    );
  }

  // ================================================================
  // BRANCH TEMPORAL E2E (ver 028_e2e_sumup_tests.sql y
  // app/api/debug/sumup-e2e/*). Las referencias "sumup_e2e_test_*"
  // NO ejecutan logica de incorporacion: solo escriben estado en la
  // tabla temporal e2e_sumup_tests para diagnostico.
  //
  // EARLY RETURN garantizado: handleE2ETest siempre devuelve un
  // NextResponse (sea referencia huerfana, verificacion fallida o
  // PAID verificado). Nunca cae al codigo de abajo que busca en
  // socio_solicitudes. Eliminar junto con la migracion 029.
  // ================================================================
  if (typeof ref === "string" && ref.startsWith("sumup_e2e_test_")) {
    return handleE2ETest(ref, event);
  }

  const supabase = await createSupabaseServerClient();

  // Buscar nuestra solicitud por el checkout_id o por el patron
  // "socio_<id>" que inyectamos como checkout_reference.
  let solicitud: SocioSolicitud | null = null;
  if (typeof ref === "string" && ref.startsWith("socio_")) {
    const id = ref.replace(/^socio_/, "");
    const { data } = await supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    solicitud = (data as SocioSolicitud | null) ?? null;
  }
  if (!solicitud && event.payload?.checkout_id) {
    const { data } = await supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("sumup_checkout_id", event.payload.checkout_id)
      .maybeSingle();
    solicitud = (data as SocioSolicitud | null) ?? null;
  }

  if (!solicitud) {
    // Pago que no corresponde a ninguna solicitud nuestra. Lo ignoramos
    // (puede ser otro flujo del mismo merchant).
    return NextResponse.json(
      { ok: true, note: "sin solicitud asociada" },
      { status: 200 }
    );
  }

  // Si ya esta pagada/enviada, idempotente: solo respondemos ok.
  if (solicitud.estado === "pagada" || solicitud.estado === "enviada") {
    return NextResponse.json({ ok: true, note: "ya procesada" });
  }

  // Defensa en profundidad: NO confiar en el payload del webhook. Hacemos
  // GET al checkout real en SumUp y validamos monto, moneda, reference
  // antes de marcar pagada. Si cualquier verificacion falla, loggeamos y
  // dejamos la solicitud en pendiente_pago (nunca marcamos pagada con
  // datos sospechosos).
  if (!solicitud.sumup_checkout_id) {
    console.error(
      "[webhook SumUp] solicitud sin sumup_checkout_id, no se puede revalidar",
      { solicitud_id: solicitud.id }
    );
    return NextResponse.json({
      ok: true,
      note: "sin sumup_checkout_id, no se procesa",
    });
  }
  let live;
  try {
    live = await obtenerCheckout(solicitud.sumup_checkout_id);
  } catch (err) {
    console.error(
      "[webhook SumUp] obtenerCheckout fallo:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "no se pudo revalidar checkout en SumUp" },
      { status: 502 }
    );
  }

  if (live.status !== "PAID") {
    // Puede ser PENDING, FAILED, EXPIRED, CANCELED. No marcamos pagada.
    return NextResponse.json({
      ok: true,
      note: `estado ${live.status}, no se procesa`,
    });
  }

  // Verificaciones de integridad: todo debe calzar con nuestra solicitud.
  // Si algo no coincide, es un pago sospechoso (otra transaccion, monto
  // alterado, moneda distinta). No marcamos pagada; loggeamos para que
  // la directiva lo revise manualmente.
  const refEsperado = `socio_${solicitud.id}`;
  if (live.checkout_reference !== refEsperado) {
    console.error("[webhook SumUp] checkout_reference no coincide", {
      esperado: refEsperado,
      recibido: live.checkout_reference,
      solicitud_id: solicitud.id,
    });
    return NextResponse.json(
      { error: "checkout_reference no coincide" },
      { status: 409 }
    );
  }
  if (live.currency !== "CLP") {
    console.error("[webhook SumUp] moneda no esperada", {
      esperado: "CLP",
      recibido: live.currency,
      solicitud_id: solicitud.id,
    });
    return NextResponse.json(
      { error: "moneda no coincide" },
      { status: 409 }
    );
  }
  if (Number(live.amount) !== Number(solicitud.monto_cuota)) {
    console.error("[webhook SumUp] monto no coincide", {
      esperado: solicitud.monto_cuota,
      recibido: live.amount,
      solicitud_id: solicitud.id,
    });
    return NextResponse.json(
      { error: "monto no coincide" },
      { status: 409 }
    );
  }

  // Normalizamos los datos de transaccion desde la respuesta live.
  const transaction_id = live.transaction_id ?? null;
  const transaction_code = live.transaction_code ?? null;

  // Crear movimiento en el libro de caja si la config lo permite.
  // Si cuenta_sumup_id esta configurada, el pago aparece como ingreso
  // en esa cuenta con la categoria "Cuota socio CdP".
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

  // Marcar como pagada. transaction_id/code vienen del GET live (defensa
  // en profundidad), no del payload del webhook.
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

  // Disparar envio automatico del QR por correo.
  try {
    await enviarCorreoQrSocio(solicitud.id);
  } catch (err) {
    // El pago quedo confirmado; si el correo falla, la directiva puede
    // reenviarlo manual desde el panel. Loggeamos pero no fallamos.
    console.error("Error enviando correo QR tras webhook SumUp:", err);
  }

  return NextResponse.json({ ok: true, movimiento_id: movimientoId });
}

// SumUp a veces hace un GET al endpoint para verificar que existe antes
// de empezar a enviar POSTs. Devolvemos 200 para no bloquearlos.
export async function GET() {
  return NextResponse.json({ ok: true, service: "sumup webhook" });
}

// ================================================================
// BRANCH TEMPORAL E2E — eliminar junto con migracion 029
// ================================================================
async function handleE2ETest(
  ref: string,
  event: WebhookPayload
): Promise<NextResponse> {
  const admin = createSupabaseAdminClient();

  // Buscar la fila de test. Si no existe, se registra el evento como
  // huerfano para que el operador pueda ver que llego pero no habia row.
  const { data: rowData } = await admin
    .from("e2e_sumup_tests")
    .select(
      "id, checkout_reference, checkout_id, monto, currency, status, paid_at"
    )
    .eq("checkout_reference", ref)
    .maybeSingle();
  const row = rowData as
    | {
        id: string;
        checkout_reference: string;
        checkout_id: string | null;
        monto: number;
        currency: string;
        status: string;
        paid_at: string | null;
      }
    | null;

  // Payload sanitizado para diagnostico — SOLO lo necesario, nada de PII.
  const sanitized = {
    event_type: event.event_type ?? null,
    checkout_id: event.payload?.checkout_id ?? event.id ?? null,
    checkout_reference: event.payload?.checkout_reference ?? null,
    status: event.payload?.status ?? null,
    // amount / currency del payload no son fuente de verdad (los
    // sacamos del GET live mas abajo).
  };

  // Si no tenemos el row es un evento HUERFANO (ejecucion abortada en
  // el create, otro entorno, otro merchant). Terminamos controlado:
  //   - loguea warning con payload sanitizado para debug;
  //   - responde HTTP 200 con nota explicita;
  //   - NO continua a obtenerCheckout, NO toca ninguna tabla, NO
  //     ejecuta logica de incorporacion. El early-return del handler
  //     principal garantiza que tampoco hay fall-through hacia
  //     socio_solicitudes para refs con prefijo sumup_e2e_test_.
  if (!row) {
    console.warn(
      "[webhook SumUp E2E] referencia huerfana (sin fila en DB), fin controlado:",
      JSON.stringify(sanitized)
    );
    return NextResponse.json({
      ok: true,
      note: "e2e: referencia huerfana, fin controlado sin side-effects",
      sanitized,
    });
  }

  // Idempotencia: si ya quedo PAID, no reprocesamos.
  if (row.status === "PAID" && row.paid_at) {
    return NextResponse.json({ ok: true, note: "e2e: ya paid, idempotente" });
  }

  // Confirmar estado real con la API — no confiamos en el payload.
  const checkoutIdLookup =
    row.checkout_id ?? event.payload?.checkout_id ?? null;
  if (!checkoutIdLookup) {
    console.error(
      "[webhook SumUp E2E] no hay checkout_id para revalidar:",
      ref
    );
    return NextResponse.json(
      { ok: false, error: "e2e: sin checkout_id" },
      { status: 400 }
    );
  }

  let live;
  try {
    live = await obtenerCheckout(checkoutIdLookup);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhook SumUp E2E] obtenerCheckout fallo:", msg);
    await admin
      .from("e2e_sumup_tests")
      .update({
        last_webhook_at: new Date().toISOString(),
        last_webhook_payload: sanitized,
        verification_errors: { obtener_checkout: msg },
      })
      .eq("id", row.id);
    return NextResponse.json(
      { ok: false, error: "e2e: obtenerCheckout fallo", detail: msg },
      { status: 502 }
    );
  }

  // Verificaciones completas. Cualquiera que falle impide marcar PAID.
  const errors: string[] = [];
  if (live.checkout_reference !== row.checkout_reference) {
    errors.push(
      `checkout_reference: expected ${row.checkout_reference}, got ${live.checkout_reference}`
    );
  }
  if (live.id !== checkoutIdLookup) {
    errors.push(
      `checkout_id: expected ${checkoutIdLookup}, got ${live.id}`
    );
  }
  if (Number(live.amount) !== Number(row.monto)) {
    errors.push(`amount: expected ${row.monto}, got ${live.amount}`);
  }
  if (live.currency !== row.currency) {
    errors.push(`currency: expected ${row.currency}, got ${live.currency}`);
  }
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE;
  if (expectedMerchant && live.merchant_code && live.merchant_code !== expectedMerchant) {
    errors.push("merchant_code: mismatch");
  }

  const nowIso = new Date().toISOString();
  const transaction_id = live.transaction_id ?? null;
  const transaction_code = live.transaction_code ?? null;

  // Solo PAID + sin errores completa paid_at.
  const esPaidValido = live.status === "PAID" && errors.length === 0;

  const update: Record<string, unknown> = {
    status: live.status,
    transaction_id,
    transaction_code,
    last_webhook_at: nowIso,
    last_webhook_payload: sanitized,
    verification_errors: errors.length > 0 ? { errors } : null,
  };
  if (esPaidValido) {
    update.paid_at = nowIso;
  }

  const { error: updErr } = await admin
    .from("e2e_sumup_tests")
    .update(update)
    .eq("id", row.id);
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "e2e: db update fallo", detail: updErr.message },
      { status: 500 }
    );
  }

  if (!esPaidValido) {
    return NextResponse.json({
      ok: true,
      note: "e2e: evento registrado",
      status: live.status,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    note: "e2e: PAID verificado y registrado",
    transaction_id,
    transaction_code,
  });
}
