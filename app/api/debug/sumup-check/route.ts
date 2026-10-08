// Endpoint de diagnostico SumUp. Protegido con requireDirectiva.
//
// Hace un POST /v0.1/checkouts minimo ($100 CLP) con los parametros
// exactos pedidos para probar que la API Online Payments de la cuenta
// SumUp del CdP esta habilitada. NO se usa en el flujo publico y se
// debe eliminar despues de confirmar el diagnostico.
//
// Uso: abrir en el navegador (logueado como directiva):
//   https://tesoria-cpcc.vercel.app/api/debug/sumup-check

import { NextResponse } from "next/server";
import { requireDirectiva } from "@/lib/auth";

export const dynamic = "force-dynamic";

const API_BASE = "https://api.sumup.com/v0.1";

export async function GET() {
  await requireDirectiva();

  const key = process.env.SUMUP_API_KEY;
  const mc = process.env.SUMUP_MERCHANT_CODE;
  if (!key || !mc) {
    return NextResponse.json(
      {
        ok: false,
        motivo: "env_faltante",
        detail: {
          SUMUP_API_KEY: !!key,
          SUMUP_MERCHANT_CODE: !!mc,
        },
      },
      { status: 500 }
    );
  }

  const checkout_reference = `test_${Date.now()}`;
  const body = {
    checkout_reference,
    amount: 100,
    currency: "CLP",
    merchant_code: mc,
    description: "Diagnostico SumUp Online Payments — ignorar",
    return_url:
      "https://tesoreria.centropadrescarampangue.cl/api/webhooks/sumup",
    hosted_checkout: { enabled: true },
  };

  const started = Date.now();
  const res = await fetch(`${API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const elapsedMs = Date.now() - started;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 1000) };
  }

  // Enmascaro merchant_code y api key en el echo del request body.
  const bodyEchoed = { ...body, merchant_code: mc.slice(0, 4) + "***" };

  const ok = res.ok;
  // Si fue OK y hay checkout.id, lo marcamos como "no completar" — no
  // vamos a pagar este checkout de prueba.
  return NextResponse.json(
    {
      ok,
      status: res.status,
      elapsedMs,
      request: {
        url: `${API_BASE}/checkouts`,
        method: "POST",
        headers: {
          Authorization: "Bearer <SUMUP_API_KEY masked>",
          "Content-Type": "application/json",
        },
        body: bodyEchoed,
      },
      response_headers: {
        "content-type": res.headers.get("content-type"),
        "x-sumup-request-id": res.headers.get("x-sumup-request-id"),
      },
      response_body: parsed,
      // Para que quede claro al leer el resultado:
      interpretacion: ok
        ? "OK — API Online Payments habilitada. Checkout de prueba creado (no se pago). ID visible en response_body.id."
        : `FALLO ${res.status}. Revisar response_body para detalle de SumUp.`,
    },
    { status: 200 }
  );
}

