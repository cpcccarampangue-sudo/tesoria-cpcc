// Endpoint publico para validar un QR de socio desde el PWA /validar.
// Responde JSON con la MINIMA informacion necesaria para acreditar la
// membresia: nombre reducido (primer nombre + inicial), estado,
// vigencia, categoria y periodo. No requiere autenticacion (el token
// del QR actua como auth: UUID v4 de 122 bits).
//
// Hardening:
//   - rate limit por IP para prevenir enumeracion de tokens.
//   - respuesta minimizada: NO devolvemos email, telefono, RUT, hijos,
//     curso, monto ni fecha de pago.
//   - mensaje de error GENERICO: no distingue entre "no existe",
//     "no pago", "periodo expirado" o "formato invalido" porque esa
//     info permite inferir datos de terceros.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getValidadorContexto, type ValidadorContexto } from "@/lib/auth";
import { hmacAudit } from "@/lib/audit/hmac";

export const dynamic = "force-dynamic";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Mensaje unico para TODOS los casos de QR no acreditable. Esto previene
// que un atacante use diferencias en el mensaje para inferir si un token
// existe, si una familia aun no pagó, o si una inscripcion fue dada de
// baja.
const MOTIVO_GENERICO =
  "La credencial no se encuentra registrada o no está vigente.";

const RL_MAX = 60;
const RL_WIN_MS = 60 * 1000;

type RespuestaInvalida = {
  valid: false;
  motivo: string;
};
type RespuestaValida = {
  valid: true;
  displayName: string;
  status: "Activo";
  category: "Apoderado";
  validUntil: string; // DD/MM/YYYY
  periodo: number;
};

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  const r = rateLimit(`validar:${ip}`, RL_MAX, RL_WIN_MS);
  if (!r.ok) {
    return NextResponse.json<RespuestaInvalida>(
      {
        valid: false,
        motivo: `Demasiados intentos. Espera ${r.retryAfterSeconds} segundos.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(r.retryAfterSeconds ?? 60) },
      }
    );
  }

  // Actor REQUERIDO: directiva o operador. Si no hay contexto, devolvemos
  // generico (sin filtrar que no estan autenticados) — pero NO escribimos
  // log (el CHECK XOR en validaciones_log exige actor).
  const ctx = await getValidadorContexto();
  if (!ctx) return invalida();

  const metodo = (req.nextUrl.searchParams.get("metodo") === "manual"
    ? "manual"
    : "qr") as "qr" | "manual";

  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token || !UUID_V4_RE.test(token)) {
    await registrarLog(ctx, metodo, "no_vigente", token ?? null, null);
    return invalida();
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: solData }, { data: cfgData }] = await Promise.all([
    supabase
      .from("socio_solicitudes")
      .select(
        "apoderado_id, apoderado_nombre, estado, periodo_anio"
      )
      .eq("qr_token", token)
      .maybeSingle(),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);

  const solicitud = solData as Pick<
    SocioSolicitud,
    "apoderado_id" | "apoderado_nombre" | "estado" | "periodo_anio"
  > | null;
  const config = cfgData as SocioConfig | null;
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();
  const apoderadoId = solicitud?.apoderado_id ?? null;

  if (!solicitud) {
    await registrarLog(ctx, metodo, "no_vigente", token, null);
    return invalida();
  }
  if (solicitud.estado !== "pagada" && solicitud.estado !== "enviada") {
    await registrarLog(ctx, metodo, "no_vigente", token, apoderadoId);
    return invalida();
  }
  if (solicitud.periodo_anio !== periodoVigente) {
    await registrarLog(ctx, metodo, "no_vigente", token, apoderadoId);
    return invalida();
  }

  const hoy = new Date().toISOString().slice(0, 10);
  if (config?.periodo_inicio && hoy < config.periodo_inicio) {
    await registrarLog(ctx, metodo, "no_vigente", token, apoderadoId);
    return invalida();
  }
  if (config?.periodo_fin && hoy > config.periodo_fin) {
    await registrarLog(ctx, metodo, "no_vigente", token, apoderadoId);
    return invalida();
  }

  const displayName = reducirNombre(solicitud.apoderado_nombre);
  const validUntil = formatearVigencia(
    config?.periodo_fin ?? null,
    periodoVigente
  );

  await registrarLog(ctx, metodo, "vigente", token, apoderadoId);

  return NextResponse.json<RespuestaValida>({
    valid: true,
    displayName,
    status: "Activo",
    category: "Apoderado",
    validUntil,
    periodo: periodoVigente,
  });
}

// Best-effort: inserta en validaciones_log con pseudonimizacion por HMAC.
// NUNCA propaga excepcion al flujo (si DB falla, log pierde la entrada
// pero la validacion al operador no se ve afectada).
async function registrarLog(
  ctx: ValidadorContexto,
  metodo: "qr" | "manual",
  resultado: "vigente" | "no_vigente" | "error",
  qrToken: string | null,
  apoderadoId: string | null
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const qrHmac = qrToken ? hmacAudit(qrToken) : null;
    const campos =
      ctx.tipo === "directiva"
        ? {
            convenio_id: null,
            convenio_operador_id: null,
            directiva_actor_hmac: hmacAudit(ctx.profile.id),
          }
        : {
            convenio_id: ctx.sesion.convenioId,
            convenio_operador_id: ctx.sesion.convenioOperadorId,
            directiva_actor_hmac: null,
          };
    await admin.from("validaciones_log").insert({
      ...campos,
      metodo,
      resultado,
      qr_token_hmac: qrHmac,
      apoderado_id: apoderadoId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[validar/api] registrarLog fallo:", msg);
  }
}

function invalida(): NextResponse<RespuestaInvalida> {
  return NextResponse.json<RespuestaInvalida>({
    valid: false,
    motivo: MOTIVO_GENERICO,
  });
}

// Toma un nombre completo y devuelve "Primer nombre + inicial del
// siguiente token con punto". Nunca devuelve mas de dos tokens visibles.
function reducirNombre(nombre: string): string {
  const partes = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (partes.length === 0) return "—";
  if (partes.length === 1) return partes[0];
  const primero = partes[0];
  const siguiente = partes[1];
  const inicial = siguiente[0].toUpperCase();
  return `${primero} ${inicial}.`;
}

// Vigencia: si hay fecha de fin configurada la usamos. Si no, 31/12 del
// periodo. Formato DD/MM/YYYY (es-CL).
function formatearVigencia(
  periodoFin: string | null,
  periodo: number
): string {
  const iso = periodoFin ?? `${periodo}-12-31`;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
