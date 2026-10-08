// Helpers del QR permanente por familia (apoderados.qr_token).
//
// Modelo:
//   - apoderados.qr_token es el QR canonico. Una familia tiene UNO solo
//     que la identifica para todos los periodos.
//   - Se genera al momento de la primera incorporacion/renovacion digital.
//   - Las socio_solicitudes historicas conservan su qr_token propio por
//     compat legacy, pero el flujo nuevo siempre consulta/escribe en
//     apoderados.qr_token.
//
// Resolucion al validar (ver resolverQrToken): se busca primero en
// apoderados; si no existe, se cae a socio_solicitudes (QR legacy).

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabase = SupabaseClient;

// Devuelve el qr_token actual del apoderado o uno nuevo generado y
// persistido. Idempotente: dos llamadas concurrentes NO deberian generar
// dos tokens distintos (unique constraint lo bloquearia; manejamos la
// race re-leyendo la fila si el insert falla).
export async function obtenerOGenerarQrFamilia(
  admin: AnySupabase,
  apoderadoId: string
): Promise<string> {
  const { data: ap, error: readErr } = await admin
    .from("apoderados")
    .select("qr_token")
    .eq("id", apoderadoId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`qr_familia: no se pudo leer apoderado: ${readErr.code ?? readErr.message}`);
  }
  const existente = (ap as { qr_token: string | null } | null)?.qr_token ?? null;
  if (existente) return existente;

  const nuevo = randomUUID();
  const { error: updErr } = await admin
    .from("apoderados")
    .update({ qr_token: nuevo })
    .eq("id", apoderadoId)
    .is("qr_token", null);
  if (updErr) {
    throw new Error(`qr_familia: no se pudo escribir qr_token: ${updErr.code ?? updErr.message}`);
  }
  // Re-leer para el caso en que otro proceso haya ganado el update
  // concurrente (nuestro .is("qr_token", null) habria no-op; el canonico
  // seria el del otro).
  const { data: after } = await admin
    .from("apoderados")
    .select("qr_token")
    .eq("id", apoderadoId)
    .maybeSingle();
  const final = (after as { qr_token: string | null } | null)?.qr_token ?? null;
  if (!final) {
    throw new Error("qr_familia: no se pudo persistir qr_token");
  }
  return final;
}

// Resuelve el apoderado dueño de un qr_token, buscando primero en
// apoderados.qr_token (canonico) y luego en socio_solicitudes.qr_token
// (compat legacy, solicitudes historicas que ya habian sido enviadas con
// un QR propio distinto al del apoderado).
//
// Devuelve { apoderadoId, origen } o null si no se encuentra.
export async function resolverQrToken(
  admin: AnySupabase,
  qrToken: string
): Promise<{ apoderadoId: string; origen: "canonico" | "legacy" } | null> {
  // 1) Canonico.
  const { data: ap } = await admin
    .from("apoderados")
    .select("id")
    .eq("qr_token", qrToken)
    .maybeSingle();
  if (ap) return { apoderadoId: (ap as { id: string }).id, origen: "canonico" };

  // 2) Legacy: buscar en solicitudes pagada/enviada con ese qr_token y
  //    tomar el apoderado_id de la mas reciente.
  const { data: solLegacy } = await admin
    .from("socio_solicitudes")
    .select("apoderado_id, periodo_anio, created_at")
    .eq("qr_token", qrToken)
    .in("estado", ["pagada", "enviada"])
    .not("apoderado_id", "is", null)
    .order("periodo_anio", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (solLegacy) {
    const sol = solLegacy as { apoderado_id: string };
    return { apoderadoId: sol.apoderado_id, origen: "legacy" };
  }
  return null;
}
