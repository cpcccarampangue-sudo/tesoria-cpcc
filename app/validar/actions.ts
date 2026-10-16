"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { requireValidador, type ValidadorContexto } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sinTildes, soloDigitos, normalizarEmail } from "@/lib/normalizar";
import { hmacAudit } from "@/lib/audit/hmac";
import type { Apoderado, Contacto, SocioConfig } from "@/lib/types";

// Server actions del validador para el metodo "Buscar por apellido".
// Acepta directiva (sesion Supabase) o operador (cookie conv_session con
// convenio+operador activos). requireValidador() valida ambos casos sin
// debilitar los chequeos existentes de directiva.

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
// Rate limit mas estricto para la confirmacion por correo. El correo
// es un espacio de busqueda mas grande (vs 4 digitos) pero igual
// mantenemos un tope bajo para desincentivar barridos automatizados.
const RL_CONFIRMAR_EMAIL_MAX = 10;
const RL_CONFIRMAR_EMAIL_WIN_MS = 10 * 60 * 1000;

async function rateLimitKey(sufijo: string, actorKey: string): Promise<string> {
  const h = await headers();
  // Combinamos actor + IP: red compartida no bloquea a varios actores
  // legitimos (cada sesion tiene su propio key); pero el abuso desde una
  // sola sesion queda limitado.
  return `${sufijo}:${actorKey}:${clientIp(h)}`;
}

function assertRateLimit(key: string, max: number, windowMs: number) {
  const r = rateLimit(key, max, windowMs);
  if (!r.ok) {
    throw new Error(
      `Demasiadas búsquedas. Espera ${r.retryAfterSeconds} segundos.`
    );
  }
}

// Key opaca del actor para rate limit: user.id si directiva,
// convenio_operador_id si operador. Nunca mezclan buckets.
function actorKey(ctx: ValidadorContexto): string {
  return ctx.tipo === "directiva"
    ? `d:${ctx.profile.id}`
    : `o:${ctx.sesion.convenioOperadorId}`;
}

type LogActorFields = {
  convenio_id: string | null;
  convenio_operador_id: string | null;
  directiva_actor_hmac: string | null;
};

// Construye los campos de actor para validaciones_log segun el contexto.
// IMPORTANTE: convenio_id SIEMPRE se saca del contexto server, nunca del
// cliente. El CHECK socio_config_origen_coherente se encarga de impedir
// combinaciones invalidas (ya validadas aqui como defensa adicional).
function actorFields(ctx: ValidadorContexto): LogActorFields {
  if (ctx.tipo === "directiva") {
    return {
      convenio_id: null,
      convenio_operador_id: null,
      directiva_actor_hmac: hmacAudit(ctx.profile.id),
    };
  }
  return {
    convenio_id: ctx.sesion.convenioId,
    convenio_operador_id: ctx.sesion.convenioOperadorId,
    directiva_actor_hmac: null,
  };
}

type RegistrarLogInput = {
  ctx: ValidadorContexto;
  // 'email' se agrega en migracion 037. Si la migracion no esta
  // aplicada, el INSERT fallara con check-constraint y registrarValidacion
  // atrapa el error (es best-effort). El flujo del validador NO se rompe.
  metodo: "qr" | "manual" | "apellido" | "email";
  resultado: "vigente" | "no_vigente" | "error";
  qrToken?: string | null;
  apoderadoId?: string | null;
};

// Best-effort: nunca propaga excepcion al flujo. Si falla, logea y sigue.
async function registrarValidacion(input: RegistrarLogInput): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const campos = actorFields(input.ctx);
    const qrHmac = input.qrToken ? hmacAudit(input.qrToken) : null;
    await supabase.from("validaciones_log").insert({
      ...campos,
      metodo: input.metodo,
      resultado: input.resultado,
      qr_token_hmac: qrHmac,
      apoderado_id: input.apoderadoId ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[validar] registrarValidacion fallo:", msg);
  }
}

// Exportado para uso desde /api/socios/validar (endpoint HTTP del QR).
export async function registrarValidacionDesdeHandler(
  input: RegistrarLogInput
): Promise<void> {
  return registrarValidacion(input);
}

// DTO reducido devuelto por buscarFamiliaPorApellido. Ninguna informacion
// sensible: solo lo justo para elegir "cual es la familia que tengo
// enfrente" y pasar al paso de confirmacion.
export type FamiliaResumen = {
  apoderadoId: string;
  nombreMask: string;
  // true si existe al menos un contacto activo con telefono con >= 4
  // digitos para confirmar por ultimos 4. false si no (socio historico
  // sin telefono): la UI oculta esa opcion.
  puedeConfirmarPorTelefono: boolean;
  // true si existe al menos un contacto activo con email para confirmar
  // identidad por el correo completo. Permite validar a socios que no
  // tienen telefono registrado.
  puedeConfirmarPorEmail: boolean;
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
  const ctx = await requireValidador();
  assertRateLimit(
    await rateLimitKey("validar:buscar-apellido", actorKey(ctx)),
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
      `actor=${actorKey(ctx)} resultados=0 q_hash=${hashCorto(q)}`
    );
    return { familias: [], hayMas: false };
  }

  // Consultamos los contactos para saber si al menos uno tiene telefono
  // y/o email. NO devolvemos ni el telefono ni el correo: solo flags.
  const { data: ctxData } = await supabase
    .from("contactos")
    .select("apoderado_id, telefono, email")
    .in("apoderado_id", ids)
    .eq("activo", true);
  const porApodTel = new Map<string, boolean>();
  const porApodEmail = new Map<string, boolean>();
  for (const c of (ctxData as Array<{
    apoderado_id: string;
    telefono: string | null;
    email: string | null;
  }> | null) ?? []) {
    const digitos = soloDigitos(c.telefono);
    if (digitos.length >= 4) porApodTel.set(c.apoderado_id, true);
    if (normalizarEmail(c.email)) porApodEmail.set(c.apoderado_id, true);
  }

  const familias: FamiliaResumen[] = subset.map((a) => ({
    apoderadoId: a.id,
    nombreMask: maskNombreFamilia(a.nombre),
    puedeConfirmarPorTelefono: porApodTel.get(a.id) ?? false,
    puedeConfirmarPorEmail: porApodEmail.get(a.id) ?? false,
  }));

  console.log(
    "[validar] buscar-apellido",
    `actor=${actorKey(ctx)} resultados=${familias.length} q_hash=${hashCorto(q)}`
  );
  return { familias, hayMas };
}

export type ConfirmarResultado =
  | {
      ok: true;
      valid: boolean;
      // Si valid=true -> socio vigente (CASO A).
      // Si valid=false -> membresia no vigente (CASO B): la familia esta
      //   registrada pero no renovo para el periodo actual.
      // Datos minimos para ambos casos (displayName no se expone si
      //   valid=false para no filtrar informacion sensible mas alla de
      //   lo que ya mostramos).
      estado?: "vigente" | "membresia_no_vigente";
      displayName?: string;
      status?: "Activo";
      category?: "Apoderado";
      validUntil?: string;
      periodo?: number;
    }
  | { ok: false; motivo: "no_disponible" | "digitos_invalidos" | "email_invalido" };

// Paso 2: confirma identidad y, si corresponde, devuelve la validez.
// Compara los ultimos 4 digitos del telefono del operador con el
// telefono de CUALQUIER contacto activo de la familia (timing-safe).
// Si no hay telefonos para comparar, devuelve no_disponible (el UI
// pedira entregar QR o contactar directiva).
export async function confirmarIdentidadYValidar(
  apoderadoId: string,
  digitos: string
): Promise<ConfirmarResultado> {
  const ctx = await requireValidador();
  assertRateLimit(
    await rateLimitKey("validar:confirmar", actorKey(ctx)),
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
      `actor=${actorKey(ctx)} apod=${apoderadoId} no_disponible`
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

  if (!match) {
    return resolverTrasPinMismatch(ctx, apoderadoId, "apellido");
  }
  return resolverVigenciaYResponder(ctx, apoderadoId, "apellido");
}

// Alternativa B: confirmar por correo electronico completo. Reutiliza
// el embudo apellido -> confirmar; aqui el "factor" es el correo. No
// permite enumerar correos sin elegir familia primero.
//
// Reglas:
//   - rate limit especifico (mas estricto que telefono).
//   - email normalizado antes de comparar (lower+NFKC).
//   - comparacion timing-safe contra TODOS los emails activos de la
//     familia; no revelamos si fallo por email no coincide o por familia
//     sin membresia (misma respuesta generica).
//   - si no hay correos activos para esta familia, no_disponible.
export async function confirmarIdentidadPorEmail(
  apoderadoId: string,
  email: string
): Promise<ConfirmarResultado> {
  const ctx = await requireValidador();
  assertRateLimit(
    await rateLimitKey("validar:confirmar-email", actorKey(ctx)),
    RL_CONFIRMAR_EMAIL_MAX,
    RL_CONFIRMAR_EMAIL_WIN_MS
  );

  const emailNorm = normalizarEmail(email);
  if (!emailNorm) {
    return { ok: false, motivo: "email_invalido" };
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      apoderadoId
    )
  ) {
    return { ok: false, motivo: "email_invalido" };
  }

  const supabase = createSupabaseAdminClient();

  const { data: ctxData } = await supabase
    .from("contactos")
    .select("email")
    .eq("apoderado_id", apoderadoId)
    .eq("activo", true);
  const emails = ((ctxData as Array<{ email: string | null }> | null) ?? [])
    .map((c) => normalizarEmail(c.email))
    .filter((e): e is string => !!e);

  if (emails.length === 0) {
    console.log(
      "[validar] confirmar-email",
      `actor=${actorKey(ctx)} apod=${apoderadoId} no_disponible`
    );
    return { ok: false, motivo: "no_disponible" };
  }

  const bufEsperado = Buffer.from(emailNorm);
  const match = emails.some((e) => {
    const be = Buffer.from(e);
    if (be.length !== bufEsperado.length) return false;
    try {
      return crypto.timingSafeEqual(be, bufEsperado);
    } catch {
      return false;
    }
  });

  if (!match) {
    return resolverTrasPinMismatch(ctx, apoderadoId, "email");
  }
  return resolverVigenciaYResponder(ctx, apoderadoId, "email");
}

// ============ helpers de resolucion de vigencia ============

// Flujo tras un factor que NO coincidio (telefono o correo): respuesta
// generica indistinguible de "familia sin socio vigente", registro en
// auditoria. NUNCA debe revelar si fue mismatch de factor o la familia
// no es socia.
async function resolverTrasPinMismatch(
  ctx: ValidadorContexto,
  apoderadoId: string,
  metodo: "apellido" | "email"
): Promise<ConfirmarResultado> {
  console.log(
    "[validar] confirmar",
    `actor=${actorKey(ctx)} apod=${apoderadoId} metodo=${metodo} factor_mismatch`
  );
  await registrarValidacion({
    ctx,
    metodo,
    resultado: "no_vigente",
    apoderadoId,
  });
  return { ok: true, valid: false };
}

// Factor OK: resolver estado del socio y devolver vigencia o no-vigente.
async function resolverVigenciaYResponder(
  ctx: ValidadorContexto,
  apoderadoId: string,
  metodo: "apellido" | "email"
): Promise<ConfirmarResultado> {
  const supabase = createSupabaseAdminClient();
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

  const sol = solData as {
    apoderado_nombre: string;
    estado: string;
    periodo_anio: number;
  } | null;
  if (!sol || sol.periodo_anio !== periodoVigente) {
    console.log(
      "[validar] confirmar",
      `actor=${actorKey(ctx)} apod=${apoderadoId} metodo=${metodo} ok_no_vigente`
    );
    await registrarValidacion({
      ctx,
      metodo,
      resultado: "no_vigente",
      apoderadoId,
    });
    return {
      ok: true,
      valid: false,
      estado: "membresia_no_vigente",
      displayName: reducirNombre(nombreFamilia),
      periodo: periodoVigente,
    };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  if (
    (config?.periodo_inicio && hoy < config.periodo_inicio) ||
    (config?.periodo_fin && hoy > config.periodo_fin)
  ) {
    await registrarValidacion({
      ctx,
      metodo,
      resultado: "no_vigente",
      apoderadoId,
    });
    return {
      ok: true,
      valid: false,
      estado: "membresia_no_vigente",
      displayName: reducirNombre(nombreFamilia),
      periodo: periodoVigente,
    };
  }

  console.log(
    "[validar] confirmar",
    `actor=${actorKey(ctx)} apod=${apoderadoId} metodo=${metodo} ok_vigente`
  );
  await registrarValidacion({
    ctx,
    metodo,
    resultado: "vigente",
    apoderadoId,
  });
  return {
    ok: true,
    valid: true,
    estado: "vigente",
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
