// Endpoint admin-only para EJECUTAR la reconciliacion de un pago PAID.
// Protegido con requireDirectiva. Service role server-side.
//
// NO acepta force_paid. NO acepta status, amount, currency ni merchant
// desde el body: todo se lee de DB + GET live SumUp.
//
// Body: { solicitud_id: uuid }  o  { checkout_id: text }
//
// Flujo:
//   1. Valida que el caller es directiva.
//   2. Lee solicitud desde DB con admin client.
//   3. Internamente reconciliarPagoSocio hace GET live + validacion +
//      RPC transaccional (migracion 035) + correo idempotente.
//   4. Devuelve resumen enmascarado del resultado.

import { NextResponse, type NextRequest } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reconciliarPagoSocio } from "@/lib/socios/reconciliar-pago";

export const dynamic = "force-dynamic";

function maskId(id: string | null | undefined): string {
  if (!id) return "<null>";
  return id.length <= 8 ? "***" : `${id.slice(0, 8)}…`;
}

export async function POST(req: NextRequest) {
  await requireDirectiva();

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const b = body as { solicitud_id?: string; checkout_id?: string };
  const solicitudId = typeof b.solicitud_id === "string" ? b.solicitud_id : null;
  const checkoutId = typeof b.checkout_id === "string" ? b.checkout_id : null;
  if (!solicitudId && !checkoutId) {
    return NextResponse.json(
      {
        ok: false,
        error: "body requiere { solicitud_id: uuid } o { checkout_id: text }",
      },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const result = solicitudId
    ? await reconciliarPagoSocio(admin, {
        modo: "por_solicitud_id",
        solicitudId,
      })
    : await reconciliarPagoSocio(admin, {
        modo: "por_checkout_id",
        checkoutId: checkoutId as string,
      });

  // Enmascarar movimiento_id en el resultado.
  const safe =
    result.resultado === "reconciliada" || result.resultado === "ya_reconciliada"
      ? {
          ...result,
          core: {
            ...result.core,
            movimiento_id_mask: maskId(result.core.movimiento_id),
            movimiento_id: undefined, // no exponemos el uuid completo
          },
        }
      : result;

  const httpStatus =
    result.resultado === "mismatch"
      ? 409
      : result.resultado === "solicitud_no_encontrada"
      ? 404
      : result.resultado === "sumup_no_disponible"
      ? 502
      : 200;

  return NextResponse.json(safe, { status: httpStatus });
}
