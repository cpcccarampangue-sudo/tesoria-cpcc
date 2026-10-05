// Cliente minimo para la API de SumUp. Soporta:
//  - Crear checkout dinamico (cada apoderado paga su cuota con monto configurado)
//  - Consultar estado de un checkout
//  - Verificar firma de webhook
//
// Env vars requeridas:
//   SUMUP_API_KEY         (secret key o access token con scope payments)
//   SUMUP_MERCHANT_CODE   (ej: MCAEMEYF para el CdP)
//   SUMUP_WEBHOOK_SECRET  (secreto para verificar firma del webhook)
//
// Docs oficiales: https://developer.sumup.com/online-payments/introduction/

const API_BASE = "https://api.sumup.com/v0.1";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} no esta configurada en las env vars`);
  return v;
}

export function sumupHabilitado(): boolean {
  return !!(env("SUMUP_API_KEY") && env("SUMUP_MERCHANT_CODE"));
}

export type CrearCheckoutInput = {
  // Identificador unico de la transaccion en nuestro sistema. Debe ser
  // unico por cada checkout (no reutilizar). Lo usamos para linkear el
  // webhook de confirmacion con nuestra solicitud.
  checkoutReference: string;
  amount: number;
  currency?: string; // default CLP
  description?: string;
  // URL a la que SumUp redirige al apoderado despues de pagar.
  returnUrl?: string;
  // Email del pagador (SumUp lo prellena en el formulario).
  payToEmail?: string;
  payerName?: string;
};

export type CheckoutResp = {
  id: string; // ID interno SumUp
  checkout_reference: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED";
  // URL a donde redirigir al apoderado para pagar (SumUp hosted page).
  checkout_url?: string;
  // Si ya se completo, trae datos de la transaccion.
  transaction_id?: string;
  transaction_code?: string;
};

async function sumupFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const key = requireEnv("SUMUP_API_KEY");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    // Server-side: no cache
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : `HTTP ${res.status}`;
    throw new Error(`SumUp ${init.method ?? "GET"} ${path} fallo: ${msg}`);
  }
  return body as T;
}

export async function crearCheckout(
  input: CrearCheckoutInput
): Promise<CheckoutResp> {
  const merchantCode = requireEnv("SUMUP_MERCHANT_CODE");
  const body = {
    checkout_reference: input.checkoutReference,
    amount: input.amount,
    currency: input.currency ?? "CLP",
    merchant_code: merchantCode,
    description: input.description,
    return_url: input.returnUrl,
    pay_to_email: input.payToEmail,
    personal_details: input.payerName
      ? { first_name: input.payerName }
      : undefined,
  };
  return await sumupFetch<CheckoutResp>("/checkouts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function obtenerCheckout(
  checkoutId: string
): Promise<CheckoutResp> {
  return await sumupFetch<CheckoutResp>(`/checkouts/${checkoutId}`);
}

// Verificacion de firma del webhook. SumUp envia un header con HMAC
// SHA-256 del body firmado con el SUMUP_WEBHOOK_SECRET. Formato segun
// documentacion: https://developer.sumup.com/online-payments/features/webhooks
export async function verificarFirmaWebhook(
  rawBody: string,
  firmaHeader: string | null
): Promise<boolean> {
  const secret = env("SUMUP_WEBHOOK_SECRET");
  if (!secret) {
    // Si el secret no esta configurado todavia, dejamos pasar en modo
    // "desarrollo". En produccion siempre debe estar seteado.
    return process.env.NODE_ENV !== "production";
  }
  if (!firmaHeader) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody)
    );
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // SumUp puede mandar la firma como "sha256=<hex>" o solo "<hex>"
    const esperado = firmaHeader.replace(/^sha256=/, "").trim().toLowerCase();
    return esperado === hex;
  } catch {
    return false;
  }
}
