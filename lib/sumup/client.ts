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
  // URL de retorno visual del browser DESPUES del hosted checkout.
  // Opcional. NO es el webhook de notificaciones (ese es return_url y
  // lo controla el helper, siempre apunta a /api/webhooks/sumup).
  redirectUrl?: string;
  // Email del pagador (SumUp lo prellena en el formulario).
  payToEmail?: string;
  payerName?: string;
};

// SumUp usa el campo "return_url" del checkout como destino de las
// notificaciones server-to-server (POST con cambios de estado). SIEMPRE
// debe apuntar a nuestro webhook publico. Usamos SUMUP_WEBHOOK_URL si
// esta seteado para evitar que un preview deploy reciba webhooks de
// pagos reales; fallback a NEXT_PUBLIC_SITE_URL.
function webhookNotificationUrl(): string {
  const explicit = process.env.SUMUP_WEBHOOK_URL;
  if (explicit) return explicit;
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://tesoreria.centropadrescarampangue.cl";
  return `${site.replace(/\/$/, "")}/api/webhooks/sumup`;
}

export type CheckoutResp = {
  id: string; // ID interno SumUp
  checkout_reference: string;
  amount: number;
  currency: string;
  merchant_code?: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED";
  // URL a donde redirigir al apoderado para pagar (SumUp hosted page).
  // SumUp a veces devuelve esto como `hosted_checkout_url`.
  checkout_url?: string;
  hosted_checkout_url?: string;
  // Si ya se completo, trae datos de la transaccion.
  transaction_id?: string;
  transaction_code?: string;
};

// Error estructurado de SumUp para que el callsite pueda inspeccionar
// status/body sin perder detalle (y para que el log sea diagnosticable).
export class SumUpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly path: string;
  readonly method: string;
  constructor(opts: {
    status: number;
    bodyText: string;
    path: string;
    method: string;
    detail: string;
  }) {
    super(
      `SumUp ${opts.method} ${opts.path} fallo HTTP ${opts.status}: ${opts.detail}`
    );
    this.name = "SumUpError";
    this.status = opts.status;
    this.bodyText = opts.bodyText;
    this.path = opts.path;
    this.method = opts.method;
  }
}

// Sanitiza un body de respuesta SumUp para loguear sin exponer secretos
// propios (nunca mandamos secretos en el body, pero el response puede
// incluir metadatos de merchant que preferimos limitar). Trunca a 500 chars.
function sanitizeForLog(bodyText: string): string {
  const t = bodyText.trim();
  if (t.length === 0) return "<empty>";
  return t.length > 500 ? t.slice(0, 500) + "…" : t;
}

async function sumupFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const key = requireEnv("SUMUP_API_KEY");
  const method = init.method ?? "GET";
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
  if (!res.ok) {
    // Extraer un detail legible del body si viene como JSON SumUp
    // (usualmente { "message": "...", "error_code": "...", "detail": "..." }).
    let detail = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof parsed.message === "string") parts.push(parsed.message);
      if (typeof parsed.detail === "string") parts.push(parsed.detail);
      if (typeof parsed.error_code === "string")
        parts.push(`code=${parsed.error_code}`);
      if (parts.length > 0) detail = parts.join(" | ");
    } catch {
      // body no es JSON: dejamos HTTP <status>
    }
    throw new SumUpError({
      status: res.status,
      bodyText: text,
      path,
      method,
      detail,
    });
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return body as T;
}

// Re-export para quienes quieran loguear detalle sin importar la clase.
export function describeSumUpError(err: unknown): string {
  if (err instanceof SumUpError) {
    return `${err.message} body=${sanitizeForLog(err.bodyText)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function crearCheckout(
  input: CrearCheckoutInput
): Promise<CheckoutResp> {
  const merchantCode = requireEnv("SUMUP_MERCHANT_CODE");
  const body: Record<string, unknown> = {
    checkout_reference: input.checkoutReference,
    amount: input.amount,
    currency: input.currency ?? "CLP",
    merchant_code: merchantCode,
    description: input.description,
    // return_url = destino de notificaciones server-to-server. SIEMPRE
    // nuestro webhook publico. No es la URL visual del browser.
    return_url: webhookNotificationUrl(),
    pay_to_email: input.payToEmail,
    personal_details: input.payerName
      ? { first_name: input.payerName }
      : undefined,
    // hosted_checkout: SumUp expone pagina lista para redirigir.
    hosted_checkout: { enabled: true },
  };
  // redirect_url = URL visual a donde el browser aterriza tras pagar.
  // Opcional; si no se setea, SumUp muestra pantalla de confirmacion
  // propia sin redirect.
  if (input.redirectUrl) {
    body.redirect_url = input.redirectUrl;
  }
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
