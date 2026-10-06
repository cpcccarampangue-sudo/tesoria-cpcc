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
import type { SocioConfig, SocioSolicitud } from "@/lib/types";
import { rateLimit, clientIp } from "@/lib/rate-limit";

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

  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token || !UUID_V4_RE.test(token)) {
    return invalida();
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: solData }, { data: cfgData }] = await Promise.all([
    supabase
      .from("socio_solicitudes")
      .select(
        "apoderado_nombre, estado, periodo_anio"
      )
      .eq("qr_token", token)
      .maybeSingle(),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);

  const solicitud = solData as Pick<
    SocioSolicitud,
    "apoderado_nombre" | "estado" | "periodo_anio"
  > | null;
  const config = cfgData as SocioConfig | null;
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();

  // Cualquier caso que no sea un socio vigente devuelve el mismo
  // mensaje generico (ver constante arriba).
  if (!solicitud) return invalida();
  if (solicitud.estado !== "pagada" && solicitud.estado !== "enviada") {
    return invalida();
  }
  if (solicitud.periodo_anio !== periodoVigente) return invalida();

  const hoy = new Date().toISOString().slice(0, 10);
  if (config?.periodo_inicio && hoy < config.periodo_inicio) return invalida();
  if (config?.periodo_fin && hoy > config.periodo_fin) return invalida();

  // Respuesta MINIMIZADA: nombre reducido, sin alumnos, sin fechas de
  // pago, sin montos. "Pamela Rodriguez Caceres" -> "Pamela R."
  const displayName = reducirNombre(solicitud.apoderado_nombre);
  const validUntil = formatearVigencia(
    config?.periodo_fin ?? null,
    periodoVigente
  );

  return NextResponse.json<RespuestaValida>({
    valid: true,
    displayName,
    status: "Activo",
    category: "Apoderado",
    validUntil,
    periodo: periodoVigente,
  });
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
