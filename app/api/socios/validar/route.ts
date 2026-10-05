// Endpoint publico para validar un QR de socio desde el PWA /validar.
// Responde JSON con el estado del socio: activo o no_valido con motivo.
// No requiere autenticacion (el token del QR actua como auth).

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Estudiante, SocioConfig, SocioSolicitud } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json(
      { estado: "no_valido", motivo: "Falta el token." },
      { status: 400 }
    );
  }

  // Validar que el token tiene forma de UUID.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({
      estado: "no_valido",
      motivo: "Este QR no corresponde a un socio del CdP.",
    });
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: solData }, { data: cfgData }] = await Promise.all([
    supabase
      .from("socio_solicitudes")
      .select("*")
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

  if (solicitud.estado !== "enviada") {
    return NextResponse.json({
      estado: "no_valido",
      motivo:
        "El pago está confirmado pero aún no se emitió el QR definitivo. Intenta en unos minutos.",
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

  return NextResponse.json({
    estado: "activo",
    apoderado: solicitud.apoderado_nombre,
    hijos,
    periodo: solicitud.periodo_anio,
    pagadaEn: solicitud.pagada_en,
  });
}
