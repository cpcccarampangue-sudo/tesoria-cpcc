// Helpers DB para el lock de creacion de checkout por socio_solicitud.
// Ver supabase/migrations/033_checkout_creacion_lock.sql.
//
// El lock esta protegido por un token (uuid) que el caller genera con
// crypto.randomUUID() y mantiene hasta el finally. Esto cierra la carrera
// de stale-release: si el lock expira (TTL 30s) y otro proceso lo toma,
// la llamada tardia a liberar() del owner original es NO-OP.
//
// Las RPC son SECURITY DEFINER con search_path='' y solo accesibles con
// service_role. SIEMPRE llamarse desde admin client (createSupabaseAdminClient).

import type { SupabaseClient } from "@supabase/supabase-js";

export type ClaimResult = "acquired" | "busy" | "checkout_changed";

export async function claimCheckoutCreacionLock(
  admin: SupabaseClient,
  solicitudId: string,
  expectedCheckoutId: string | null,
  lockToken: string
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc("claim_checkout_creacion_lock", {
    p_solicitud_id: solicitudId,
    p_expected_checkout_id: expectedCheckoutId,
    p_lock_token: lockToken,
  });
  if (error) {
    throw new Error(`claim_checkout_creacion_lock RPC fallo: ${error.message}`);
  }
  const v = typeof data === "string" ? data : String(data);
  if (v === "acquired" || v === "busy" || v === "checkout_changed") return v;
  throw new Error(`claim_checkout_creacion_lock devolvio valor desconocido: ${v}`);
}

// Libera el lock SOLO si el token coincide con el almacenado.
// Devuelve true si libero, false si el token no era dueño (otro proceso
// reemplazo el lock por expiracion). false NO es error — es el disenio.
export async function liberarCheckoutCreacionLock(
  admin: SupabaseClient,
  solicitudId: string,
  lockToken: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("liberar_checkout_creacion_lock", {
    p_solicitud_id: solicitudId,
    p_lock_token: lockToken,
  });
  if (error) {
    // Best-effort: el TTL 30s cubre si el liberar falla.
    console.error("[pago-lock] liberar fallo:", error.message);
    return false;
  }
  return data === true;
}

// Lee sumup_checkout_id actual (poll corto). Devuelve null si no existe.
export async function leerSumupCheckoutIdFresco(
  admin: SupabaseClient,
  solicitudId: string
): Promise<string | null> {
  const { data } = await admin
    .from("socio_solicitudes")
    .select("sumup_checkout_id")
    .eq("id", solicitudId)
    .maybeSingle();
  const row = data as { sumup_checkout_id: string | null } | null;
  return row?.sumup_checkout_id ?? null;
}

// Persiste sumup_checkout_id de forma condicional (compare-and-set).
// Si rowCount = 0, significa que otro proceso ya cambio el id entre
// nuestras operaciones. El caller debe re-resolver.
// NO toca el lock aqui — la limpieza completa la hace liberarCheckoutCreacionLock
// en el finally del caller, usando el token.
export async function persistirCheckoutIdCondicional(
  admin: SupabaseClient,
  solicitudId: string,
  expectedCheckoutId: string | null,
  nuevoCheckoutId: string
): Promise<"persistido" | "perdido"> {
  let q = admin
    .from("socio_solicitudes")
    .update({ sumup_checkout_id: nuevoCheckoutId })
    .eq("id", solicitudId);
  if (expectedCheckoutId === null) {
    q = q.is("sumup_checkout_id", null);
  } else {
    q = q.eq("sumup_checkout_id", expectedCheckoutId);
  }
  const { data, error } = await q.select("id");
  if (error) throw new Error(`persistir checkout_id fallo: ${error.message}`);
  return (data?.length ?? 0) > 0 ? "persistido" : "perdido";
}
