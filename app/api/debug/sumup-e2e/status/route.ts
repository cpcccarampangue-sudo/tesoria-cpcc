// Status E2E SumUp (TEMPORAL). Protegido con requireDirectiva.
//
// GET /api/debug/sumup-e2e/status?ref=sumup_e2e_test_XXX
//     o
// GET /api/debug/sumup-e2e/status?id=<checkout_id>
//
// Devuelve el estado guardado en DB (lo que escribio el webhook) y el
// estado live de SumUp (via GET /v0.1/checkouts/{id}), para comparar.

import { NextResponse, type NextRequest } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { obtenerCheckout } from "@/lib/sumup/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await requireDirectiva();

  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!ref && !id) {
    return NextResponse.json(
      { ok: false, error: "pasa ?ref=... o ?id=..." },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const q = admin
    .from("e2e_sumup_tests")
    .select(
      "id, checkout_reference, checkout_id, monto, currency, status, " +
        "transaction_id, transaction_code, created_at, paid_at, " +
        "last_webhook_at, last_webhook_payload, verification_errors"
    );
  const { data: row } = await (ref
    ? q.eq("checkout_reference", ref).maybeSingle()
    : q.eq("checkout_id", id!).maybeSingle());

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "test no encontrado" },
      { status: 404 }
    );
  }

  const r = row as unknown as {
    checkout_id: string | null;
    [k: string]: unknown;
  };

  let live: unknown = null;
  let live_error: string | null = null;
  if (r.checkout_id) {
    try {
      const l = await obtenerCheckout(r.checkout_id);
      live = {
        id: l.id,
        checkout_reference: l.checkout_reference,
        amount: l.amount,
        currency: l.currency,
        merchant_code: l.merchant_code ? l.merchant_code.slice(0, 4) + "***" : null,
        status: l.status,
        transaction_id: l.transaction_id,
        transaction_code: l.transaction_code,
        // Campos adicionales expuestos por SumUp (si vienen) utiles
        // para diagnosticar config del checkout.
        return_url: (l as unknown as { return_url?: string }).return_url ?? null,
        hosted_checkout_url: l.hosted_checkout_url ?? l.checkout_url ?? null,
      };
    } catch (err) {
      live_error = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    ok: true,
    db: r,
    live,
    live_error,
  });
}
