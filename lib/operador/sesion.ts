// Sesion de operador de convenio para /validar.
//
// Diseno:
//   - Token: 32 bytes random (crypto.randomUUID() da 128 bits; usamos
//     randomBytes para 256 bits). El token real vive SOLO en la cookie.
//   - En DB guardamos SHA-256(token) como session_hash. Si se filtra la
//     base no se pueden secuestrar sesiones vigentes.
//   - TTL absoluto 24h. last_used_at NO extiende expires_at (es solo
//     auditoria).
//   - En cada request se re-valida que el convenio y el operador sigan
//     activos; si cualquiera se desactivo, la sesion deja de ser valida
//     incluso dentro de las 24h.
//
// Cookie: conv_session (HttpOnly, Secure, SameSite=Lax, Max-Age=86400).

import { randomBytes, createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const CONV_COOKIE = "conv_session";
export const CONV_SESION_TTL_HORAS = 24;
const CONV_SESION_TTL_MS = CONV_SESION_TTL_HORAS * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generarTokenSesion(): string {
  // 32 bytes = 256 bits de entropia (hex: 64 chars).
  return randomBytes(32).toString("hex");
}

export type SesionOperadorInfo = {
  sesionId: string;
  convenioId: string;
  convenioOperadorId: string;
  convenioNombre: string;
  convenioLogoUrl: string | null;
  expiresAt: string;
};

// Crea una sesion. REQUIERE que el llamador ya haya verificado que el
// operador pertenece al convenio, que ambos estan activos y que el
// convenio esta en vigencia. No duplicamos esos checks aqui para no
// hacer la query doble; el callsite publico es el que debe garantizar.
export async function crearSesionOperador(
  convenioOperadorId: string,
  convenioId: string
): Promise<{ token: string; expiresAt: Date }> {
  const supabase = createSupabaseAdminClient();
  const token = generarTokenSesion();
  const session_hash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONV_SESION_TTL_MS);
  const { error } = await supabase.from("convenio_sesiones").insert({
    session_hash,
    convenio_id: convenioId,
    convenio_operador_id: convenioOperadorId,
    expires_at: expiresAt.toISOString(),
  });
  if (error) {
    throw new Error(
      `No se pudo crear la sesion operador: ${error.code ?? "db error"}`
    );
  }
  return { token, expiresAt };
}

// Lee la sesion vigente de un token de cookie. Devuelve null si:
//   - token mal formado,
//   - sesion no existe / expirada / revocada,
//   - operador o convenio ya no estan activos.
// Actualiza last_used_at silenciosamente (best-effort, no revienta la
// request si falla).
export async function obtenerSesionOperador(
  token: string | undefined | null
): Promise<SesionOperadorInfo | null> {
  if (!token) return null;
  const trimmed = String(token).trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return null;
  const session_hash = hashToken(trimmed);

  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("convenio_sesiones")
    .select(
      "id, convenio_id, convenio_operador_id, expires_at, revoked_at, " +
        "convenios!inner(id, nombre, logo_url, active, valid_from, valid_until), " +
        "convenio_operadores!inner(id, active)"
    )
    .eq("session_hash", session_hash)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    convenio_id: string;
    convenio_operador_id: string;
    expires_at: string;
    revoked_at: string | null;
    convenios: {
      id: string;
      nombre: string;
      logo_url: string | null;
      active: boolean;
      valid_from: string | null;
      valid_until: string | null;
    };
    convenio_operadores: { id: string; active: boolean };
  };
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!row.convenio_operadores.active) return null;
  if (!row.convenios.active) return null;
  // Vigencia del convenio.
  const hoy = new Date().toISOString().slice(0, 10);
  if (row.convenios.valid_from && hoy < row.convenios.valid_from) return null;
  if (row.convenios.valid_until && hoy > row.convenios.valid_until) return null;

  // Best-effort: actualizar last_used_at. No esperamos ni fallamos si no.
  supabase
    .from("convenio_sesiones")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return {
    sesionId: row.id,
    convenioId: row.convenio_id,
    convenioOperadorId: row.convenio_operador_id,
    convenioNombre: row.convenios.nombre,
    convenioLogoUrl: row.convenios.logo_url,
    expiresAt: row.expires_at,
  };
}

export async function revocarSesionOperador(token: string): Promise<void> {
  if (!token) return;
  const trimmed = String(token).trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return;
  const session_hash = hashToken(trimmed);
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("convenio_sesiones")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_hash", session_hash)
    .is("revoked_at", null);
}
