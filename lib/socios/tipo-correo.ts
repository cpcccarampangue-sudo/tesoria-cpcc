// Helper centralizado para decidir si el correo post-pago debe ser
// "bienvenida" (primera vez socio) o "renovacion" (ya era socio en un
// periodo anterior).
//
// Se calcula al INSERT de la solicitud y se guarda en
// socio_solicitudes.tipo_correo. Nunca se recalcula: el snapshot es
// inmune a UPDATEs posteriores de apoderados.socio_periodo.
//
// Criterio (digital OR importado):
//   - Digital: existe otra socio_solicitudes del mismo apoderado con
//     estado pagada/enviada y periodo_anio < periodoActual.
//   - Importado: apoderados.socio=true AND socio_periodo IS NOT NULL
//     AND socio_periodo < periodoActual (familias que entraron por
//     Excel offline).
//
// Si no cumple ninguna -> bienvenida.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoCorreoSocio = "bienvenida" | "renovacion";

export async function determinarTipoCorreo(
  admin: SupabaseClient,
  apoderadoId: string | null,
  periodoActual: number,
  excluirSolicitudId?: string
): Promise<TipoCorreoSocio> {
  if (!apoderadoId) return "bienvenida";

  // Query solicitudes digitales previas.
  let q = admin
    .from("socio_solicitudes")
    .select("id", { count: "exact", head: true })
    .eq("apoderado_id", apoderadoId)
    .in("estado", ["pagada", "enviada"])
    .lt("periodo_anio", periodoActual);
  if (excluirSolicitudId) q = q.neq("id", excluirSolicitudId);
  const [{ count }, { data: ap }] = await Promise.all([
    q,
    admin
      .from("apoderados")
      .select("socio, socio_periodo")
      .eq("id", apoderadoId)
      .maybeSingle(),
  ]);

  const digitalPrevio = (count ?? 0) > 0;
  const apRow = ap as { socio: boolean; socio_periodo: number | null } | null;
  const importadoPrevio =
    apRow?.socio === true &&
    apRow.socio_periodo != null &&
    apRow.socio_periodo < periodoActual;

  return digitalPrevio || importadoPrevio ? "renovacion" : "bienvenida";
}
