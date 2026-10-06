// Endpoint publico para validar un QR de socio desde el PWA /validar.
// Responde JSON con el estado del socio: activo o no_valido con motivo.
// No requiere autenticacion (el token del QR actua como auth): el token
// es un UUID v4 (gen_random_uuid, 122 bits de entropia) y es
// impredecible/opaco.
//
// Hardening:
//   - rate limit por IP para evitar que un atacante enumere tokens.
//   - respuesta minimizada: solo lo necesario para validar visualmente.
//   - mensajes de error que NO distinguen entre "no existe" y "mal formato"
//     cuando no es util para el validador.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Estudiante, SocioConfig, SocioSolicitud } from "@/lib/types";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Permitimos escaneos rapidos consecutivos en eventos reales (una
// persona de la directiva puede escanear 1 QR cada 2-3 segundos), pero
// cerramos la puerta a enumeracion masiva.
const RL_MAX = 60;
const RL_WIN_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  const r = rateLimit(`validar:${ip}`, RL_MAX, RL_WIN_MS);
  if (!r.ok) {
    return NextResponse.json(
      {
        estado: "no_valido",
        motivo: `Demasiados intentos. Espera ${r.retryAfterSeconds} segundos.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(r.retryAfterSeconds ?? 60) },
      }
    );
  }

  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json(
      { estado: "no_valido", motivo: "Falta el token." },
      { status: 400 }
    );
  }

  // Validamos forma estricta de UUID v4. Rechazamos pre-consulta para
  // no gastar queries en basura y para no distinguir en el tiempo entre
  // "mal formato" y "token inexistente".
  if (!UUID_V4_RE.test(token)) {
    return NextResponse.json({
      estado: "no_valido",
      motivo: "Este QR no corresponde a un socio del CdP.",
    });
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: solData }, { data: cfgData }] = await Promise.all([
    supabase
      .from("socio_solicitudes")
      .select(
        "id, apoderado_id, apoderado_nombre, alumno_nombre, curso, estado, periodo_anio, pagada_en"
      )
      .eq("qr_token", token)
      .maybeSingle(),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);

  const solicitud = solData as SocioSolicitud | null;
  const config = cfgData as SocioConfig | null;
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();

  if (!solicitud) {
    return NextResponse.json({
      estado: "no_valido",
      motivo: "Este QR no corresponde a ningún socio registrado.",
    });
  }

  if (solicitud.estado === "pendiente_pago") {
    return NextResponse.json({
      estado: "no_valido",
      motivo: "El socio aún no completa el pago de su cuota.",
    });
  }

  if (solicitud.estado === "rechazada" || solicitud.estado === "anulada") {
    return NextResponse.json({
      estado: "no_valido",
      motivo: "Esta inscripción fue dada de baja.",
    });
  }

  if (solicitud.periodo_anio !== periodoVigente) {
    return NextResponse.json({
      estado: "no_valido",
      motivo: `QR del período ${solicitud.periodo_anio}, ya no vigente (actual: ${periodoVigente}).`,
    });
  }

  // El QR es valido una vez que el pago esta confirmado (estados
  // "pagada" o "enviada"). El envio de correo es opcional y no debe
  // bloquear la validez de la membresia.
  if (solicitud.estado !== "pagada" && solicitud.estado !== "enviada") {
    return NextResponse.json({
      estado: "no_valido",
      motivo: "Esta inscripción no está activa.",
    });
  }

  // Validacion por fecha: si el periodo tiene inicio/fin configurados,
  // el QR solo es valido entre esas fechas.
  const hoy = new Date().toISOString().slice(0, 10);
  if (config?.periodo_inicio && hoy < config.periodo_inicio) {
    return NextResponse.json({
      estado: "no_valido",
      motivo: `El período ${periodoVigente} empieza el ${config.periodo_inicio}.`,
    });
  }
  if (config?.periodo_fin && hoy > config.periodo_fin) {
    return NextResponse.json({
      estado: "no_valido",
      motivo: `Este QR expiró el ${config.periodo_fin}.`,
    });
  }

  // Cargar hijos de la familia linkeada, si aplica.
  let hijos: Array<{ nombre: string; curso: string | null }> = [];
  if (solicitud.apoderado_id) {
    const { data: estData } = await supabase
      .from("estudiantes")
      .select("nombre, curso")
      .eq("apoderado_id", solicitud.apoderado_id)
      .eq("activo", true)
      .order("nombre");
    hijos = ((estData as Pick<Estudiante, "nombre" | "curso">[] | null) ?? []).map(
      (e) => ({ nombre: e.nombre, curso: e.curso })
    );
  }
  // Fallback para solicitudes antiguas sin apoderado_id linkeado.
  if (hijos.length === 0) {
    hijos = [{ nombre: solicitud.alumno_nombre, curso: solicitud.curso }];
  }

  // Respuesta minimizada: solo lo que el validador necesita para
  // contrastar visualmente la identidad del portador del QR. No
  // devolvemos email, telefono, RUT ni monto pagado.
  return NextResponse.json({
    estado: "activo",
    apoderado: solicitud.apoderado_nombre,
    hijos,
    periodo: solicitud.periodo_anio,
    pagadaEn: solicitud.pagada_en,
  });
}
