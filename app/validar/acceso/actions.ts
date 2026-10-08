"use server";

import { cookies, headers } from "next/headers";
import {
  emitirCodigo,
  verificarCodigo,
  obtenerSesion,
  consumirSesion,
  OTP_CONFIG,
} from "@/lib/otp/service";
import { enviarOtpEmail } from "@/lib/otp/email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizarEmail } from "@/lib/normalizar";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  CONV_COOKIE,
  CONV_SESION_TTL_HORAS,
  crearSesionOperador,
  revocarSesionOperador,
} from "@/lib/operador/sesion";

// Cookie unica de la sesion OTP pre-autenticacion (purpose="operador").
// Al pasar OTP, el flujo decide: 1 convenio -> abre sesion operador,
// varios -> muestra selector, 0 -> mensaje especifico.
const OTP_OPERADOR_COOKIE = "otp_operador_session";

// Rate limits locales para los endpoints del flujo operador.
const RL_OTP_SOLICITUD_MAX = 5;
const RL_OTP_SOLICITUD_WIN_MS = 60 * 60 * 1000;
const RL_OTP_VERIFICAR_MAX = 20;
const RL_OTP_VERIFICAR_WIN_MS = 60 * 60 * 1000;

export type SolicitarOtpResult =
  | { ok: true; reintentarEnSeg?: number }
  | { ok: false; motivo: "error_servicio" };

// Paso 1: solicitar OTP. Igual que /incorporacion, siempre devuelve ok
// (con/sin reintentar) para no revelar si el correo es de un operador
// registrado — anti-enumeracion. Si hay excepcion no esperada, devuelve
// motivo generico.
export async function solicitarOtpOperador(email: string): Promise<SolicitarOtpResult> {
  try {
    const h = await headers();
    const ip = clientIp(h);

    const r = rateLimit(
      `otp-op:solicitar:${ip}`,
      RL_OTP_SOLICITUD_MAX,
      RL_OTP_SOLICITUD_WIN_MS
    );
    if (!r.ok) {
      return { ok: true, reintentarEnSeg: r.retryAfterSeconds ?? 60 };
    }

    const emailNorm = normalizarEmail(email);
    if (!emailNorm) return { ok: true };

    const emisor = await emitirCodigo(emailNorm, "operador", ip);
    if (!emisor.ok) {
      if (emisor.motivo === "reenvio_muy_rapido") {
        return { ok: true, reintentarEnSeg: emisor.segundosRestantes };
      }
      return { ok: true };
    }
    try {
      await enviarOtpEmail(emailNorm, emisor.codigo);
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      const msg = err instanceof Error ? err.message : "";
      console.error("[otp-op] enviar email fallo:", name, msg);
      return { ok: false, motivo: "error_servicio" };
    }
    console.log(
      "[otp-op] solicitud",
      `email=${enmascararEmailLog(emailNorm)} ip=${ip} ok`
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const name = err instanceof Error ? err.name : "Error";
    console.error("[otp-op] solicitarOtpOperador error:", name, msg);
    return { ok: false, motivo: "error_servicio" };
  }
}

export type VerificarOtpResult =
  | { ok: true }
  | {
      ok: false;
      motivo:
        | "codigo_invalido"
        | "codigo_expirado"
        | "max_intentos"
        | "error_servicio";
    };

// Paso 2: verificar OTP. Setea cookie OTP_OPERADOR_COOKIE con la sesion
// OTP (purpose="operador") de 30 min. Esta cookie NO autoriza aun el
// uso de /validar — solo prueba que el correo fue verificado. El paso
// 3 (abrirSesionOperador) consume esta sesion y abre la de 24h.
export async function verificarOtpOperador(
  email: string,
  codigo: string
): Promise<VerificarOtpResult> {
  try {
    const h = await headers();
    const ip = clientIp(h);
    const r = rateLimit(
      `otp-op:verificar:${ip}`,
      RL_OTP_VERIFICAR_MAX,
      RL_OTP_VERIFICAR_WIN_MS
    );
    if (!r.ok) return { ok: false, motivo: "max_intentos" };

    const emailNorm = normalizarEmail(email);
    const codigoLimpio = (codigo ?? "").replace(/\D/g, "").slice(0, 6);
    if (!emailNorm || codigoLimpio.length !== 6) {
      return { ok: false, motivo: "codigo_invalido" };
    }
    const res = await verificarCodigo(emailNorm, codigoLimpio, "operador", ip);
    if (!res.ok) {
      console.log(
        "[otp-op] verificar",
        `email=${enmascararEmailLog(emailNorm)} motivo=${res.motivo}`
      );
      return res;
    }
    const c = await cookies();
    c.set(OTP_OPERADOR_COOKIE, res.sesionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: OTP_CONFIG.SESION_TTL_MIN * 60,
    });
    console.log("[otp-op] verificar", `email=${enmascararEmailLog(emailNorm)} ok`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[otp-op] verificarOtpOperador error:", msg);
    return { ok: false, motivo: "error_servicio" };
  }
}

export type ConvenioDisponible = {
  convenioId: string;
  convenioOperadorId: string;
  nombre: string;
  logoUrl: string | null;
};

export type EstadoPostOtpOperador =
  | { estado: "sin_sesion" }
  | { estado: "ningun_convenio_activo" }
  | { estado: "ya_autorizado"; convenio: { nombre: string; logoUrl: string | null } }
  | { estado: "listo"; convenios: ConvenioDisponible[] };

// Paso 3: dado un OTP ya verificado, lista los convenios activos y
// vigentes del operador. 0 -> mensaje especifico. 1 -> el UI puede
// invocar abrirSesionOperador directamente. Varios -> selector.
// Si ya hay cookie conv_session valida, devuelve ya_autorizado (el UI
// redirige a /validar).
export async function estadoPostOtpOperador(): Promise<EstadoPostOtpOperador> {
  try {
    const c = await cookies();

    // Chequear si ya hay sesion operador activa (p.ej. refrescaron la
    // pagina). Si si, redirigir al validador. Usamos obtenerSesionOperador
    // via lazy import para no cargar admin client innecesariamente.
    const convToken = c.get(CONV_COOKIE)?.value;
    if (convToken) {
      const { obtenerSesionOperador } = await import("@/lib/operador/sesion");
      const ya = await obtenerSesionOperador(convToken);
      if (ya) {
        return {
          estado: "ya_autorizado",
          convenio: { nombre: ya.convenioNombre, logoUrl: ya.convenioLogoUrl },
        };
      }
    }

    const sid = c.get(OTP_OPERADOR_COOKIE)?.value;
    if (!sid) return { estado: "sin_sesion" };
    const sesion = await obtenerSesion(sid, "operador");
    if (!sesion) return { estado: "sin_sesion" };

    const supabase = createSupabaseAdminClient();
    const hoy = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("convenio_operadores")
      .select(
        "id, convenio_id, active, convenios!inner(id, nombre, logo_url, active, valid_from, valid_until)"
      )
      .eq("email_normalized", sesion.email)
      .eq("active", true);
    const filas = ((data as Array<{
      id: string;
      convenio_id: string;
      active: boolean;
      convenios: {
        id: string;
        nombre: string;
        logo_url: string | null;
        active: boolean;
        valid_from: string | null;
        valid_until: string | null;
      };
    }> | null) ?? []).filter((row) => {
      const c = row.convenios;
      if (!c.active) return false;
      if (c.valid_from && hoy < c.valid_from) return false;
      if (c.valid_until && hoy > c.valid_until) return false;
      return true;
    });

    if (filas.length === 0) {
      return { estado: "ningun_convenio_activo" };
    }

    return {
      estado: "listo",
      convenios: filas.map((f) => ({
        convenioId: f.convenio_id,
        convenioOperadorId: f.id,
        nombre: f.convenios.nombre,
        logoUrl: f.convenios.logo_url,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[otp-op] estadoPostOtpOperador error:", msg);
    return { estado: "sin_sesion" };
  }
}

export type AbrirSesionResult =
  | { ok: true }
  | { ok: false; motivo: "sesion_otp_invalida" | "convenio_no_autorizado" | "error_servicio" };

// Paso 4: abre la sesion operador de 24h para el convenio elegido.
// Re-verifica que el (operador, convenio) exista y este activo antes
// de crear la sesion — nunca confia en que el convenioOperadorId
// enviado por el cliente corresponda al email del OTP.
export async function abrirSesionOperador(
  convenioOperadorId: string
): Promise<AbrirSesionResult> {
  try {
    const c = await cookies();
    const sid = c.get(OTP_OPERADOR_COOKIE)?.value;
    if (!sid) return { ok: false, motivo: "sesion_otp_invalida" };
    const sesion = await obtenerSesion(sid, "operador");
    if (!sesion) return { ok: false, motivo: "sesion_otp_invalida" };

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        convenioOperadorId
      )
    ) {
      return { ok: false, motivo: "convenio_no_autorizado" };
    }

    const supabase = createSupabaseAdminClient();
    const hoy = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("convenio_operadores")
      .select(
        "id, convenio_id, email_normalized, active, convenios!inner(id, active, valid_from, valid_until)"
      )
      .eq("id", convenioOperadorId)
      .maybeSingle();
    const fila = data as {
      id: string;
      convenio_id: string;
      email_normalized: string;
      active: boolean;
      convenios: {
        id: string;
        active: boolean;
        valid_from: string | null;
        valid_until: string | null;
      };
    } | null;
    if (!fila) return { ok: false, motivo: "convenio_no_autorizado" };
    // El operador debe corresponder al email del OTP (nunca confiar en
    // que el cliente mando el id correcto).
    if (fila.email_normalized !== sesion.email) {
      return { ok: false, motivo: "convenio_no_autorizado" };
    }
    if (!fila.active) return { ok: false, motivo: "convenio_no_autorizado" };
    if (!fila.convenios.active) return { ok: false, motivo: "convenio_no_autorizado" };
    if (fila.convenios.valid_from && hoy < fila.convenios.valid_from) {
      return { ok: false, motivo: "convenio_no_autorizado" };
    }
    if (fila.convenios.valid_until && hoy > fila.convenios.valid_until) {
      return { ok: false, motivo: "convenio_no_autorizado" };
    }

    const { token, expiresAt } = await crearSesionOperador(
      fila.id,
      fila.convenio_id
    );

    // Consumimos la sesion OTP: la verificacion del correo da acceso a
    // UNA sola apertura de sesion operador. Si quiere elegir otro
    // convenio despues, nueva verificacion.
    await consumirSesion(sesion.id);

    c.set(CONV_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: CONV_SESION_TTL_HORAS * 60 * 60,
    });
    // Limpiamos la cookie OTP operador (ya se consumio).
    c.delete(OTP_OPERADOR_COOKIE);
    console.log(
      "[otp-op] abrirSesionOperador",
      `convenio=${fila.convenio_id} operador=${fila.id} expiresAt=${expiresAt.toISOString()}`
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[otp-op] abrirSesionOperador error:", msg);
    return { ok: false, motivo: "error_servicio" };
  }
}

// Cierre explicito desde el banner "Cerrar sesion" del operador en /validar.
export async function cerrarSesionOperador(): Promise<void> {
  const c = await cookies();
  const token = c.get(CONV_COOKIE)?.value;
  if (token) {
    try {
      await revocarSesionOperador(token);
    } catch {
      // best-effort: igual borramos la cookie
    }
  }
  c.delete(CONV_COOKIE);
}

export async function cambiarCorreoOperador(): Promise<void> {
  const c = await cookies();
  c.delete(OTP_OPERADOR_COOKIE);
}

function enmascararEmailLog(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const dom = email.slice(at + 1);
  const dotDom = dom.indexOf(".");
  const dom1 = dotDom > 0 ? dom.slice(0, dotDom) : dom;
  const dom2 = dotDom > 0 ? dom.slice(dotDom) : "";
  return `${local[0]}***@${dom1[0]}***${dom2}`;
}
