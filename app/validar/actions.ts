"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sinTildes, soloDigitos } from "@/lib/normalizar";
import type { Apoderado, Contacto, SocioConfig } from "@/lib/types";

// Server actions del validador para el metodo "Buscar por apellido".
// Todos requieren sesion de directiva. En el futuro, cuando llegue el
// modulo convenios, se agrega el chequeo de rol operador aqui mismo
// (reemplazar requireDirectiva por requireValidador o similar).

// Longitud minima del apellido para evitar enumeracion masiva.
const APELLIDO_MIN = 3;
// Maximo de resultados devueltos (DTO reducido).
const MAX_RESULTADOS = 8;

// Rate limits combinados: por usuario (sesion) + IP, para evitar que
// un atacante enumere con muchas busquedas.
const RL_BUSCAR_MAX = 30;
const RL_BUSCAR_WIN_MS = 10 * 60 * 1000; // 30/10min por usuario+IP
const RL_CONFIRMAR_MAX = 15;
const RL_CONFIRMAR_WIN_MS = 10 * 60 * 1000;

async function rateLimitKey(sufijo: string, userId: string): Promise<string> {
  const h = await headers();
  // Combinamos user + IP: colegio con red compartida no bloquea a varias
  // familias legitimas (porque cada operador autenticado tiene su propia
  // sesion); pero el abuso desde una sola sesion queda limitado.
  return `${sufijo}:${userId}:${clientIp(h)}`;
}

function assertRateLimit(key: string, max: number, windowMs: number) {
  const r = rateLimit(key, max, windowMs);
  if (!r.ok) {
    throw new Error(
      `Demasiadas búsquedas. Espera ${r.retryAfterSeconds} segundos.`
    );
  }
}

// DTO reducido devuelto por buscarFamiliaPorApellido. Ninguna informacion
// sensible: solo lo justo para elegir "cual es la familia que tengo
// enfrente" y pasar al paso de confirmacion.
export type FamiliaResumen = {
  apoderadoId: string;
  nombreMask: string;
  // true si existe al menos un contacto con telefono valido para
  // confirmar identidad por sus ultimos 4 digitos. false si no, para
  // mostrar un aviso adecuado en la UI.
  puedeConfirmar: boolean;
};

export type BuscarResultado = {
  familias: FamiliaResumen[];
  hayMas: boolean;
};

// Busqueda por apellido para el validador autenticado. Normaliza
// (NFKC + sin tildes + lowercase), exige minimo 3 caracteres, y
// devuelve DTO reducido. NO devuelve pagos, hijos, telefonos, email.
export async function buscarFamiliaPorApellido(
  consulta: string
): Promise<BuscarResultado> {
  const perfil = await requireDirectiva();
  assertRateLimit(
    await rateLimitKey("validar:buscar-apellido", perfil.id),
    RL_BUSCAR_MAX,
    RL_BUSCAR_WIN_MS
  );

  const q = sinTildes(consulta ?? "");
  if (q.length < APELLIDO_MIN) {
    throw new Error(
      `Ingresa al menos ${APELLIDO_MIN} caracteres del apellido para buscar.`
    );
  }

  const supabase = createSupabaseAdminClient();
  // Query parametrizada via supabase-js (nunca concatenamos SQL).
  // ilike usa el patron %q% — pero la comparacion es case-insensitive
  // sin tolerancia a tildes a nivel DB. Para que coincida con "sinTildes"
  // (p.ej. buscar "gonzalez" matchee "González"), traemos un batch
  // generoso y filtramos nosotros con sinTildes().
  const { data } = await supabase
    .from("apoderados")
    .select("id, nombre, activo")
    .ilike("nombre", `%${q}%`)
    .eq("activo", true)
    .limit(MAX_RESULTADOS * 3);

  const todos = ((data as Pick<Apoderado, "id" | "nombre" | "activo">[]) ?? [])
    .filter((a) => sinTildes(a.nombre).includes(q));

  const hayMas = todos.length > MAX_RESULTADOS;
  const subset = todos.slice(0, MAX_RESULTADOS);
  const ids = subset.map((a) => a.id);
  if (ids.length === 0) {
    console.log(
      "[validar] buscar-apellido",
      `user=${perfil.id} resultados=0 q_hash=${hashCorto(q)}`
    );
    return { familias: [], hayMas: false };
  }

  // Consultamos los contactos para saber si al menos uno tiene telefono
  // (NO devolvemos el telefono).
  const { data: ctxData } = await supabase
    .from("contactos")
    .select("apoderado_id, telefono")
    .in("apoderado_id", ids)
    .eq("activo", true);
  const porApod = new Map<string, boolean>();
  for (const c of (ctxData as Array<{ apoderado_id: string; telefono: string | null }> | null) ??
    []) {
    const digitos = soloDigitos(c.telefono);
    if (digitos.length >= 4) porApod.set(c.apoderado_id, true);
  }

  const familias: FamiliaResumen[] = subset.map((a) => ({
    apoderadoId: a.id,
    nombreMask: maskNombreFamilia(a.nombre),
    puedeConfirmar: porApod.get(a.id) ?? false,
  }));

  console.log(
    "[validar] buscar-apellido",
    `user=${perfil.id} resultados=${familias.length} q_hash=${hashCorto(q)}`
  );
  return { familias, hayMas };
}

export type ConfirmarResultado =
  | {
      ok: true;
      valid: boolean;
      // Solo si valid=true, respuesta minima tipo /api/socios/validar.
      displayName?: string;
      status?: "Activo";
      category?: "Apoderado";
      validUntil?: string;
      periodo?: number;
    }
  | { ok: false; motivo: "no_disponible" | "digitos_invalidos" };

// Paso 2: confirma identidad y, si corresponde, devuelve la validez.
// Compara los ultimos 4 digitos del telefono del operador con el
// telefono de CUALQUIER contacto activo de la familia (timing-safe).
// Si no hay telefonos para comparar, devuelve no_disponible (el UI
// pedira entregar QR o contactar directiva).
export async function confirmarIdentidadYValidar(
  apoderadoId: string,
  digitos: string
): Promise<ConfirmarResultado> {
  const perfil = await requireDirectiva();
  assertRateLimit(
    await rateLimitKey("validar:confirmar", perfil.id),
    RL_CONFIRMAR_MAX,
    RL_CONFIRMAR_WIN_MS
  );

  const dig = soloDigitos(digitos).slice(-4);
  if (dig.length !== 4) {
    return { ok: false, motivo: "digitos_invalidos" };
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      apoderadoId
    )
  ) {
    return { ok: false, motivo: "digitos_invalidos" };
  }

  const supabase = createSupabaseAdminClient();

  // Traemos los contactos activos de la familia y comparamos tiempo-constante
  // contra cada telefono (ultimos 4 digitos).
  const { data: ctxData } = await supabase
    .from("contactos")
    .select("telefono")
    .eq("apoderado_id", apoderadoId)
    .eq("activo", true);
  const telefonos = ((ctxData as Array<{ telefono: string | null }> | null) ?? [])
    .map((c) => soloDigitos(c.telefono).slice(-4))
    .filter((t) => t.length === 4);

  if (telefonos.length === 0) {
    console.log(
      "[validar] confirmar",
      `user=${perfil.id} apod=${apoderadoId} no_disponible`
    );
    return { ok: false, motivo: "no_disponible" };
  }

  const bufEsperado = Buffer.from(dig);
  const match = telefonos.some((t) => {
    const bt = Buffer.from(t);
    if (bt.length !== bufEsperado.length) return false;
    try {
      return crypto.timingSafeEqual(bt, bufEsperado);
    } catch {
      return false;
    }
  });

  // Si no coincide, mismo resultado que "familia sin socio vigente":
  // mensaje generico. No revelamos si el PIN estuvo mal o la familia no
  // es socia.
  if (!match) {
    console.log(
      "[validar] confirmar",
      `user=${perfil.id} apod=${apoderadoId} pin_mismatch`
    );
    return { ok: true, valid: false };
  }

  // Pin OK: resolvemos la vigencia como lo hace /api/socios/validar.
  const [{ data: cfgData }, { data: solData }, { data: apData }] =
    await Promise.all([
      supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("socio_solicitudes")
        .select("apoderado_nombre, estado, periodo_anio")
        .eq("apoderado_id", apoderadoId)
        .in("estado", ["pagada", "enviada"])
        .order("periodo_anio", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("apoderados").select("nombre").eq("id", apoderadoId).maybeSingle(),
    ]);
  const config = cfgData as SocioConfig | null;
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();

  const nombreFamilia =
    (solData as { apoderado_nombre: string } | null)?.apoderado_nombre ??
    (apData as { nombre: string } | null)?.nombre ??
    "";

  // Si no hay solicitud pagada/enviada en periodo vigente -> no vigente.
  const sol = solData as {
    apoderado_nombre: string;
    estado: string;
    periodo_anio: number;
  } | null;
  if (!sol || sol.periodo_anio !== periodoVigente) {
    console.log(
      "[validar] confirmar",
      `user=${perfil.id} apod=${apoderadoId} ok_no_vigente`
    );
    return { ok: true, valid: false };
  }

  // Validacion por fecha del periodo.
  const hoy = new Date().toISOString().slice(0, 10);
  if (config?.periodo_inicio && hoy < config.periodo_inicio) {
    return { ok: true, valid: false };
  }
  if (config?.periodo_fin && hoy > config.periodo_fin) {
    return { ok: true, valid: false };
  }

  console.log(
    "[validar] confirmar",
    `user=${perfil.id} apod=${apoderadoId} ok_vigente`
  );
  return {
    ok: true,
    valid: true,
    displayName: reducirNombre(nombreFamilia),
    status: "Activo",
    category: "Apoderado",
    validUntil: formatearVigencia(config?.periodo_fin ?? null, periodoVigente),
    periodo: periodoVigente,
  };
}

// ============ helpers de masking / display ============

function maskNombreFamilia(nombre: string): string {
  // "González Pérez" -> "G••••••z P••••z"
  return nombre
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (w.length <= 1) return w;
      if (w.length === 2) return w[0] + "•";
      const inner = "•".repeat(Math.max(2, w.length - 2));
      return w[0] + inner + w[w.length - 1];
    })
    .join(" ");
}

function reducirNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[1][0].toUpperCase()}.`;
}

function formatearVigencia(
  periodoFin: string | null,
  periodo: number
): string {
  const iso = periodoFin ?? `${periodo}-12-31`;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Hash corto solo para auditoria (identificar que una misma consulta se
// repite, sin almacenar el texto). sha256 truncado a 10 chars.
function hashCorto(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
}
