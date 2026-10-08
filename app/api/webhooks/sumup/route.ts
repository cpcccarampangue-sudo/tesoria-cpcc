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
import { verificarFirmaWebhook, obtenerCheckout } from "@/lib/sumup/client";
import { enviarCorreoQrSocio } from "@/lib/socios/enviar-qr";
import { handleE2ETest } from "@/lib/sumup/e2e-handler";
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

  // SumUp envia payloads con formas variadas segun el tipo de evento:
  //   - A veces trae payload.checkout_reference directamente.
  //   - A veces trae payload.checkout_id (UUID).
  //   - A veces solo trae event.id = UUID del checkout (sin payload).
  // En cualquier caso, el UNICO identificador confiable para resolver
  // nuestros datos es llamar a GET /v0.1/checkouts/{id} y leer el
  // checkout_reference real.
  //
  // Estrategia:
  //   1) Intentar sacar checkout_reference directo del payload si viene.
  //   2) Si no, sacar un UUID candidato (payload.checkout_id o event.id)
  //      y resolver via API para obtener checkout_reference real.
  //   3) Con el checkout_reference en mano, decidir el branch.

  const refDirecta = event.payload?.checkout_reference ?? null;
  const idCandidato =
    event.payload?.checkout_id ??
    (typeof event.id === "string" ? event.id : null);

  let refResuelta: string | null = refDirecta;
  let liveCheckout: Awaited<ReturnType<typeof obtenerCheckout>> | null = null;

  if (!refResuelta && idCandidato) {
    try {
      liveCheckout = await obtenerCheckout(idCandidato);
      refResuelta = liveCheckout.checkout_reference ?? null;
    } catch (err) {
      console.error(
        "[webhook SumUp] no se pudo resolver checkout desde id:",
        idCandidato,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (!refResuelta) {
    console.warn(
      "[webhook SumUp] evento sin referencia resoluble:",
      JSON.stringify({
        event_type: event.event_type,
        id: event.id,
        payload_keys: event.payload ? Object.keys(event.payload) : null,
      })
    );
    return NextResponse.json(
      { ok: true, note: "evento sin referencia resoluble, ignorado" },
      { status: 200 }
    );
  }

  const ref = refResuelta;

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
  if (ref.startsWith("sumup_e2e_test_")) {
    return handleE2ETest(ref, event, liveCheckout);
  }

  const supabase = await createSupabaseServerClient();

  // Buscar nuestra solicitud por el patron "socio_<id>" en la ref ya
  // resuelta (viene del payload o del GET live) y, como fallback, por
  // el sumup_checkout_id que podamos haber guardado antes.
  let solicitud: SocioSolicitud | null = null;
  if (ref.startsWith("socio_")) {
    const id = ref.replace(/^socio_/, "");
    const { data } = await supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    solicitud = (data as SocioSolicitud | null) ?? null;
  }
  const checkoutIdFallback =
    event.payload?.checkout_id ??
    (liveCheckout ? liveCheckout.id : null) ??
    (typeof event.id === "string" ? event.id : null);
  if (!solicitud && checkoutIdFallback) {
    const { data } = await supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("sumup_checkout_id", checkoutIdFallback)
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
  if (liveCheckout && liveCheckout.id === solicitud.sumup_checkout_id) {
    live = liveCheckout;
  } else {
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

