// Endpoint TEMPORAL de diagnostico SumUp E2E.
// Protegido con requireDirectiva. Crea un checkout de $100 CLP con
// reference "sumup_e2e_test_<timestamp>" para probar el pipeline
// completo (crear -> pagar -> webhook -> revalidar). NUNCA toca
// socio_solicitudes, apoderados, movimientos ni emite QR.
//
// Uso: POST /api/debug/sumup-e2e/create
//      (basta un fetch sin body desde el browser logueado como directiva)
//
// Devuelve: { checkout_id, hosted_checkout_url, checkout_reference }
//
// Eliminar junto con /api/debug/sumup-e2e/* cuando se confirme OK.

import { NextResponse } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { crearCheckout } from "@/lib/sumup/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MONTO_TEST = 100;
const CURRENCY_TEST = "CLP";

export async function POST() {
  await requireDirectiva();

  const checkout_reference = `sumup_e2e_test_${Date.now()}`;
  const admin = createSupabaseAdminClient();

  // Insert previo del registro para que si el webhook llega antes de la
  // respuesta del create (poco probable, pero posible), el branch e2e
  // del webhook encuentre la fila por checkout_reference.
  const { error: insErr } = await admin.from("e2e_sumup_tests").insert({
    checkout_reference,
    monto: MONTO_TEST,
    currency: CURRENCY_TEST,
    status: "PENDING",
  });
  if (insErr) {
    return NextResponse.json(
      { ok: false, step: "insert_db", error: insErr.message },
      { status: 500 }
    );
  }

  let checkout;
  try {
    checkout = await crearCheckout({
      checkoutReference: checkout_reference,
      amount: MONTO_TEST,
      currency: CURRENCY_TEST,
      description: `E2E SumUp test - ignorar (${checkout_reference})`,
      // No pasamos redirectUrl: la prueba E2E termina en SumUp hosted
      // page, sin volver visualmente a nuestra app. return_url (webhook)
      // lo pone el helper automaticamente.
    });
  } catch (err) {
    // Si falla la creacion, mantenemos la fila pero con estado FAILED
    // para visibilidad.
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from("e2e_sumup_tests")
      .update({
        status: "FAILED",
        verification_errors: { create_error: msg },
      })
      .eq("checkout_reference", checkout_reference);
    return NextResponse.json(
      { ok: false, step: "crear_checkout", error: msg },
      { status: 502 }
    );
  }

  // Guardar checkout_id para que el webhook lo encuentre.
  await admin
    .from("e2e_sumup_tests")
    .update({ checkout_id: checkout.id })
    .eq("checkout_reference", checkout_reference);

  const hosted_checkout_url =
    checkout.hosted_checkout_url ?? checkout.checkout_url ?? null;

  return NextResponse.json({
    ok: true,
    checkout_id: checkout.id,
    checkout_reference,
    hosted_checkout_url,
    amount: checkout.amount,
    currency: checkout.currency,
    status: checkout.status,
    instrucciones:
      hosted_checkout_url
        ? `Abre hosted_checkout_url en el navegador y paga $100 CLP. Luego consulta status con GET /api/debug/sumup-e2e/status?ref=${checkout_reference}`
        : "SumUp no devolvio hosted_checkout_url. Reportar.",
  });
}
