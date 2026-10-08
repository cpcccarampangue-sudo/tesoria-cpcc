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
