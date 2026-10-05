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

  // Confirmar el estado contra la API (defensa en profundidad: no
  // confiar solo en el webhook).
  let estadoReal = event.payload?.status;
  if (solicitud.sumup_checkout_id) {
    try {
      const live = await obtenerCheckout(solicitud.sumup_checkout_id);
      estadoReal = live.status;
      if (live.transaction_id) {
        event.payload = {
          ...(event.payload ?? {}),
          transaction_id: live.transaction_id,
          transaction_code: live.transaction_code,
        };
      }
    } catch {
      // Si falla el GET, confiamos en lo que vino en el webhook.
    }
  }

  if (estadoReal !== "PAID") {
    // No es un pago exitoso (puede ser PENDING, FAILED, EXPIRED, etc.)
    // No cambiamos estado — queda en pendiente_pago hasta que llegue el PAID.
    return NextResponse.json({
      ok: true,
      note: `estado ${estadoReal}, no se procesa`,
    });
  }

  // Marcar como pagada
  const { error: updErr } = await supabase
    .from("socio_solicitudes")
    .update({
      estado: "pagada",
      pagada_en: new Date().toISOString(),
      sumup_transaction_id: event.payload?.transaction_id ?? null,
      sumup_transaction_code: event.payload?.transaction_code ?? null,
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

  return NextResponse.json({ ok: true });
}

// SumUp a veces hace un GET al endpoint para verificar que existe antes
// de empezar a enviar POSTs. Devolvemos 200 para no bloquearlos.
export async function GET() {
  return NextResponse.json({ ok: true, service: "sumup webhook" });
}
