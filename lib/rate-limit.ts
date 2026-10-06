// Rate limiter en memoria con sliding window. Pensado para endpoints
// publicos (incorporacion, validar) donde no esperamos trafico alto y
// basta con proteger contra abuso rapido desde una IP/clave.
//
// IMPORTANTE: en Vercel serverless cada instancia tiene su propia
// memoria; un atacante que rota entre instancias puede evadir el limite.
// Para proteccion mas robusta deberiamos usar Upstash Redis o KV, pero
// por ahora in-memory es un primer escudo suficiente contra bots simples
// y accidentes (clicks repetidos del mismo usuario).

const buckets = new Map<string, number[]>();

// Cleanup periodico: cada 5 minutos purgamos keys con entradas viejas
// para que el map no crezca sin control. Solo arranca en runtime server.
if (typeof setInterval !== "undefined" && typeof process !== "undefined") {
  const CLEAN_INTERVAL = 5 * 60 * 1000;
  const KEEP = 10 * 60 * 1000; // conservar ultimo 10 min
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of buckets.entries()) {
      const filtered = arr.filter((t) => now - t < KEEP);
      if (filtered.length === 0) buckets.delete(k);
      else buckets.set(k, filtered);
    }
  }, CLEAN_INTERVAL).unref?.();
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

/**
 * Chequea si una clave puede proceder.
 * @param key identificador unico (p.ej. "incorporacion:buscar:1.2.3.4")
 * @param max cantidad maxima de requests en la ventana
 * @param windowMs tamano de la ventana en ms
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const arr = buckets.get(key) ?? [];
  const vigentes = arr.filter((t) => now - t < windowMs);

  if (vigentes.length >= max) {
    const oldestInWindow = Math.min(...vigentes);
    const retryAfterMs = windowMs - (now - oldestInWindow);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  vigentes.push(now);
  buckets.set(key, vigentes);
  return { ok: true, remaining: max - vigentes.length };
}

// Extrae la IP del cliente respetando los headers que Vercel usa en edge.
// Fallback a 'unknown' para no romper la logica si no esta disponible.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
