// Lista E2E SumUp (TEMPORAL). Protegido con requireDirectiva.
//
// GET /api/debug/sumup-e2e/list
//
// Lista todos los tests ordenados por created_at desc. Solo datos de DB
// (no hace live fetch para no abusar de la API SumUp).

import { NextResponse } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireDirectiva();
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("e2e_sumup_tests")
    .select(
      "id, checkout_reference, checkout_id, monto, currency, status, " +
        "transaction_id, transaction_code, created_at, paid_at, " +
        "last_webhook_at, verification_errors"
    )
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ ok: true, tests: data ?? [] });
}
