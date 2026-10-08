// Replay E2E SumUp (TEMPORAL). Protegido con requireDirectiva.
//
// POST /api/debug/sumup-e2e/replay
// body: { checkout_id?: string, checkout_reference?: string }
//
// Reutiliza la logica del webhook (handleE2ETest) sin que SumUp tenga
// que mandar el evento. Util para procesar un checkout que ya quedo
// PAID en SumUp pero cuyo webhook no actualizo la fila por un bug.
//
// NO cobra nada: solo re-ejecuta la verificacion live + update de la
// fila e2e_sumup_tests.

import { NextResponse, type NextRequest } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { obtenerCheckout } from "@/lib/sumup/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handleE2ETest } from "@/lib/sumup/e2e-handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await requireDirectiva();

  let body: { checkout_id?: string; checkout_reference?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Si no viene body JSON intentar query strings.
    body = {
      checkout_id: req.nextUrl.searchParams.get("checkout_id") ?? undefined,
      checkout_reference:
        req.nextUrl.searchParams.get("checkout_reference") ?? undefined,
    };
  }

  let { checkout_id, checkout_reference } = body;

  // Si solo nos pasan checkout_reference, buscar el checkout_id en DB.
  if (!checkout_id && checkout_reference) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("e2e_sumup_tests")
      .select("checkout_id, checkout_reference")
      .eq("checkout_reference", checkout_reference)
      .maybeSingle();
    const row = data as { checkout_id: string | null } | null;
    checkout_id = row?.checkout_id ?? undefined;
    if (!checkout_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "no se encontro checkout_id en DB para la referencia",
        },
        { status: 404 }
      );
    }
  }

  if (!checkout_id) {
    return NextResponse.json(
      {
        ok: false,
        error: "pasa { checkout_id } o { checkout_reference } en el body",
      },
      { status: 400 }
    );
  }

  // Hacer GET al checkout para resolver reference real.
  let live;
  try {
    live = await obtenerCheckout(checkout_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, step: "obtenerCheckout", error: msg },
      { status: 502 }
    );
  }

  const ref = live.checkout_reference;
  if (!ref || !ref.startsWith("sumup_e2e_test_")) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "el checkout no tiene reference 'sumup_e2e_test_*'; este endpoint solo replay-ea tests E2E",
        checkout_reference: ref,
      },
      { status: 400 }
    );
  }

  // Simular el payload que mandaria SumUp y pasarselo al handler real.
  const syntheticEvent = {
    event_type: "replay.manual",
    id: live.id,
    payload: {
      checkout_id: live.id,
      checkout_reference: ref,
      status: live.status,
    },
  };

  const resp = await handleE2ETest(ref, syntheticEvent, live);
  // Devolver tal cual la respuesta del handler, mas metadata del replay.
  const handlerBody = await resp.json();
  return NextResponse.json({
    ok: resp.ok,
    replay: true,
    checkout_id,
    checkout_reference: ref,
    handler_status: resp.status,
    handler_response: handlerBody,
  });
}
