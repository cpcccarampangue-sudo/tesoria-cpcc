// TEMPORAL — helper del branch E2E del webhook SumUp.
// Mantener aislado del resto para que la eliminacion sea quirurgica
// (borrar este archivo + /api/debug/sumup-e2e/* + migracion 029).

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { obtenerCheckout } from "@/lib/sumup/client";

export type E2EWebhookPayload = {
  event_type?: string;
  id?: string;
  payload?: {
    checkout_reference?: string;
    checkout_id?: string;
    transaction_id?: string;
    transaction_code?: string;
    status?: string;
  };
};

export async function handleE2ETest(
  ref: string,
  event: E2EWebhookPayload,
  liveCheckout: Awaited<ReturnType<typeof obtenerCheckout>> | null = null
): Promise<NextResponse> {
  const admin = createSupabaseAdminClient();

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
  };

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

  if (row.status === "PAID" && row.paid_at) {
    return NextResponse.json({ ok: true, note: "e2e: ya paid, idempotente" });
  }

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
  if (liveCheckout && liveCheckout.id === checkoutIdLookup) {
    live = liveCheckout;
  } else {
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
  }

  const errors: string[] = [];
  if (live.checkout_reference !== row.checkout_reference) {
    errors.push(
      `checkout_reference: expected ${row.checkout_reference}, got ${live.checkout_reference}`
    );
  }
  if (live.id !== checkoutIdLookup) {
    errors.push(`checkout_id: expected ${checkoutIdLookup}, got ${live.id}`);
  }
  if (Number(live.amount) !== Number(row.monto)) {
    errors.push(`amount: expected ${row.monto}, got ${live.amount}`);
  }
  if (live.currency !== row.currency) {
    errors.push(`currency: expected ${row.currency}, got ${live.currency}`);
  }
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE;
  if (
    expectedMerchant &&
    live.merchant_code &&
    live.merchant_code !== expectedMerchant
  ) {
    errors.push("merchant_code: mismatch");
  }

  const nowIso = new Date().toISOString();
  const transaction_id = live.transaction_id ?? null;
  const transaction_code = live.transaction_code ?? null;

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
