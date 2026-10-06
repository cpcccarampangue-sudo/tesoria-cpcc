// Servicio de OTP para verificar que el solicitante tiene acceso al correo
// que esta usando en /incorporacion.
//
// Diseno:
//   - Codigo de 6 digitos generado con crypto.randomInt (CSPRNG).
//   - Hasheado con SHA-256(pepper + email + codigo). El pepper vive en
//     la env var OTP_SECRET (nunca en frontend ni base). Si se filtra la
//     base de datos, el atacante no puede validar OTPs sin el pepper.
//   - Comparacion tiempo-constante al verificar.
//   - 10 min de vigencia, 5 intentos por codigo, 60s minimos entre
//     reenvios, max 3 solicitudes por correo cada 15 min + 5/h por IP.
//   - Al emitir un nuevo codigo para el mismo correo, los anteriores
//     se invalidan inmediatamente (invalidado_en).
//   - La verificacion exitosa crea una otp_sesiones con uuid v4; ese uuid
//     va en cookie HttpOnly / Secure / SameSite=Lax de 30 min. Al
//     consumir la sesion para un flujo completo, se marca used_at.
//
// IMPORTANTE: usar createSupabaseAdminClient (service role) para hablar
// con las tablas; estan con RLS cerrado para anon/authenticated.

import crypto from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const OTP_LEN = 6;
const OTP_TTL_MIN = 10;
const OTP_MAX_INTENTOS = 5;
const OTP_REENVIO_MIN_SEG = 60;
const SESION_TTL_MIN = 30;

function pepper(): string {
  const p = process.env.OTP_SECRET;
  if (!p || p.length < 16) {
    throw new Error(
      "OTP_SECRET no esta configurado (debe tener al menos 16 caracteres)."
    );
  }
  return p;
}

export function generarCodigo(): string {
  // crypto.randomInt es criptograficamente seguro. Padding con ceros
  // para asegurar siempre 6 digitos.
  const n = crypto.randomInt(0, 10 ** OTP_LEN);
  return n.toString().padStart(OTP_LEN, "0");
}

export function hashOtp(codigo: string, email: string): string {
  const h = crypto.createHash("sha256");
  h.update(`${pepper()}|${email.toLowerCase().trim()}|${codigo}`);
  return h.digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type EmitirResultado =
  | { ok: true; codigo: string } // codigo en texto plano SOLO para enviar al email
  | { ok: false; motivo: "reenvio_muy_rapido"; segundosRestantes: number }
  | { ok: false; motivo: "limite_por_correo" };

// Verifica cuotas por correo (3/15min) + reenvio minimo (60s), invalida
// cualquier codigo anterior vigente y emite uno nuevo. NO revela si el
// correo existe en la base de apoderados.
export async function emitirCodigo(
  email: string,
  ip: string | null
): Promise<EmitirResultado> {
  const supabase = createSupabaseAdminClient();
  const emailNorm = email.toLowerCase().trim();

  // Limite por correo: 3 solicitudes cada 15 min.
  const desde15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count: countCorreo } = await supabase
    .from("otp_codigos")
    .select("id", { count: "exact", head: true })
    .eq("email", emailNorm)
    .gte("created_at", desde15);
  if ((countCorreo ?? 0) >= 3) {
    return { ok: false, motivo: "limite_por_correo" };
  }

  // Reenvio minimo: 60s desde el ultimo codigo.
  const { data: ultimo } = await supabase
    .from("otp_codigos")
    .select("created_at")
    .eq("email", emailNorm)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultimo) {
    const haceSeg = (Date.now() - new Date(ultimo.created_at).getTime()) / 1000;
    if (haceSeg < OTP_REENVIO_MIN_SEG) {
      return {
        ok: false,
        motivo: "reenvio_muy_rapido",
        segundosRestantes: Math.ceil(OTP_REENVIO_MIN_SEG - haceSeg),
      };
    }
  }

  // Invalidar codigos anteriores vigentes del mismo correo.
  await supabase
    .from("otp_codigos")
    .update({ invalidado_en: new Date().toISOString() })
    .eq("email", emailNorm)
    .is("invalidado_en", null)
    .is("usado_en", null);

  // Emitir uno nuevo.
  const codigo = generarCodigo();
  const codigoHash = hashOtp(codigo, emailNorm);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

  const { error } = await supabase.from("otp_codigos").insert({
    email: emailNorm,
    codigo_hash: codigoHash,
    expires_at: expiresAt,
    ip,
  });
  if (error) {
    throw new Error(`No se pudo registrar el OTP: ${error.code ?? "db error"}`);
  }

  return { ok: true, codigo };
}

export type VerificarResultado =
  | { ok: true; sesionId: string }
  | { ok: false; motivo: "codigo_invalido" }
  | { ok: false; motivo: "codigo_expirado" }
  | { ok: false; motivo: "max_intentos" };

// Verifica un codigo. Devuelve el sesionId para setear la cookie si OK.
// NO revela si el correo tenia o no un codigo asociado (en los dos casos
// devuelve codigo_invalido).
export async function verificarCodigo(
  email: string,
  codigo: string,
  ip: string | null
): Promise<VerificarResultado> {
  const supabase = createSupabaseAdminClient();
  const emailNorm = email.toLowerCase().trim();

  // Buscar el ultimo codigo activo del correo.
  const { data: fila } = await supabase
    .from("otp_codigos")
    .select("id, codigo_hash, intentos, expires_at, usado_en, invalidado_en")
    .eq("email", emailNorm)
    .is("usado_en", null)
    .is("invalidado_en", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fila) {
    return { ok: false, motivo: "codigo_invalido" };
  }

  if (new Date(fila.expires_at).getTime() < Date.now()) {
    await supabase
      .from("otp_codigos")
      .update({ invalidado_en: new Date().toISOString() })
      .eq("id", fila.id);
    return { ok: false, motivo: "codigo_expirado" };
  }

  if (fila.intentos >= OTP_MAX_INTENTOS) {
    await supabase
      .from("otp_codigos")
      .update({ invalidado_en: new Date().toISOString() })
      .eq("id", fila.id);
    return { ok: false, motivo: "max_intentos" };
  }

  const esperado = fila.codigo_hash as string;
  const candidato = hashOtp(codigo.trim(), emailNorm);
  const match = timingSafeEqualHex(esperado, candidato);

  if (!match) {
    // Incrementamos intentos; si pasa el max, invalidamos.
    const nuevoIntentos = fila.intentos + 1;
    const patch: Record<string, unknown> = { intentos: nuevoIntentos };
    if (nuevoIntentos >= OTP_MAX_INTENTOS) {
      patch.invalidado_en = new Date().toISOString();
    }
    await supabase.from("otp_codigos").update(patch).eq("id", fila.id);
    if (nuevoIntentos >= OTP_MAX_INTENTOS) {
      return { ok: false, motivo: "max_intentos" };
    }
    return { ok: false, motivo: "codigo_invalido" };
  }

  // Marcar como usado.
  await supabase
    .from("otp_codigos")
    .update({ usado_en: new Date().toISOString() })
    .eq("id", fila.id);

  // Crear sesion de 30 min.
  const expiresAt = new Date(
    Date.now() + SESION_TTL_MIN * 60 * 1000
  ).toISOString();
  const { data: sesion, error } = await supabase
    .from("otp_sesiones")
    .insert({ email: emailNorm, expires_at: expiresAt, ip })
    .select("id")
    .single();
  if (error || !sesion) {
    throw new Error(
      `No se pudo crear la sesion de verificacion: ${error?.code ?? "db error"}`
    );
  }

  return { ok: true, sesionId: sesion.id as string };
}

export type Sesion = {
  id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
};

// Lee la sesion por id (viene de la cookie). Devuelve null si no existe,
// expiro, o ya fue consumida.
export async function obtenerSesion(id: string): Promise<Sesion | null> {
  if (!id) return null;
  // Validamos forma UUID antes de pegar a la DB.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    )
  ) {
    return null;
  }
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("otp_sesiones")
    .select("id, email, expires_at, used_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const s = data as Sesion;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  if (s.used_at) return null;
  return s;
}

export async function consumirSesion(id: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("otp_sesiones")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id);
}

export const OTP_CONFIG = {
  OTP_LEN,
  OTP_TTL_MIN,
  OTP_MAX_INTENTOS,
  OTP_REENVIO_MIN_SEG,
  SESION_TTL_MIN,
} as const;
