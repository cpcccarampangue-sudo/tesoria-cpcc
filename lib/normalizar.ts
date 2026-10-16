// Helpers de normalizacion de inputs del usuario. Centralizados para que
// el frontend y el servidor apliquen EXACTAMENTE la misma transformacion
// antes de comparar con lo que vive en base de datos.
//
// Si el frontend normaliza y el server normaliza distinto (o uno no
// normaliza), aparecen bugs del tipo "en desktop encuentra, en mobile no".

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Caracteres zero-width que algunos teclados moviles / autofill agregan
// y que trim() no quita: ZWSP, ZWNJ, ZWJ, BOM.
const ZERO_WIDTH_RE = /[​‌‍﻿]/g;

// Combining diacritical marks (tildes) para quitar acentos.
const DIACRITICS_RE = /[̀-ͯ]/g;

/**
 * Normaliza un correo electronico de forma determinista:
 *   1. normalize("NFKC") — unifica variantes Unicode (ej. ligaduras,
 *      caracteres de ancho completo que algunos teclados moviles usan).
 *   2. elimina caracteres zero-width del inicio/medio/fin.
 *   3. trim() de espacios estandar.
 *   4. toLowerCase() porque los dominios de correo son case-insensitive
 *      y en la practica tratamos el local-part tambien asi.
 *
 * El resultado es una cadena lista para comparar contra la base. Si no
 * paso la validacion basica de formato, devuelve null.
 */
export function normalizarEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.normalize("NFKC");
  s = s.replace(ZERO_WIDTH_RE, "");
  s = s.trim();
  s = s.toLowerCase();
  if (!EMAIL_RE.test(s)) return null;
  return s;
}

/**
 * Version que no valida formato — util para pasos previos (ej. masking).
 */
export function limpiarEmail(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .trim()
    .toLowerCase();
}

/**
 * Normaliza un texto quitando tildes y bajando a lowercase. Pensado
 * para comparar nombres/apellidos de forma tolerante a tildes y
 * capitalizacion:
 *   "González"  -> "gonzalez"
 *   "GONZÁLEZ"  -> "gonzalez"
 *   "Nuñez"     -> "nunez"
 * Ojo: tambien saca eñe. Para el caso de uso (buscar apellido) es
 * aceptable y aumenta tolerancia (gente que no escribe la enie).
 */
export function sinTildes(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(DIACRITICS_RE, "")
    .replace(/ñ/gi, "n")
    .toLowerCase()
    .trim();
}

/**
 * Deja solo los digitos de una cadena. Util para comparar los ultimos
 * N digitos de un telefono sin importar formato.
 */
export function soloDigitos(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\D/g, "");
}

/**
 * Normaliza un telefono celular chileno al formato canonico +56XXXXXXXXX
 * (prefijo +56 + 9 digitos empezando por 9).
 *
 * Reglas de aceptacion (en orden):
 *   1. Normaliza unicode (NFKC) y limpia zero-width + espacios.
 *   2. Deja solo digitos.
 *   3. Si viene con prefijo pais 56 (ej. 56912345678), lo quita.
 *   4. Si tras quitar prefijos quedan EXACTAMENTE 9 digitos y empieza
 *      por 9, es valido -> devuelve "+56" + los 9 digitos.
 *   5. Cualquier otra longitud/forma -> null (ambiguo o invalido).
 *
 * Ejemplos:
 *   "+56 9 5528 2630"  -> "+56955282630"
 *   "56955282630"      -> "+56955282630"
 *   "955282630"        -> "+56955282630"
 *   "9 5528 2630"      -> "+56955282630"
 *   "22 345 6789"      -> null  (fijo, no cumple "empieza por 9")
 *   "55282630"         -> null  (8 digitos, incompleto)
 *   "+56 2 2345 6789"  -> null  (fijo chileno, no celular)
 *   null | "" | " "    -> null
 *
 * Diseno conservador: no inventa. Si no se puede determinar sin ambiguedad
 * que es un celular chileno de 9 digitos, devuelve null. Esto respeta
 * el principio de no corromper datos historicos ambiguos durante backfills.
 */
export function normalizarTelefonoCL(
  input: string | null | undefined
): string | null {
  if (!input) return null;
  let s = input.normalize("NFKC").replace(ZERO_WIDTH_RE, "").trim();
  if (!s) return null;
  let digitos = s.replace(/\D/g, "");
  if (digitos.length === 0) return null;
  // Si empieza con 56 y queda largo compatible con +56 + 9 digitos, lo
  // quitamos. 56 es prefijo pais Chile; cualquier otro caso lo dejamos
  // tal cual para que el chequeo de longitud lo rechace.
  if (digitos.length === 11 && digitos.startsWith("56")) {
    digitos = digitos.slice(2);
  }
  // Formato celular chileno: 9 digitos iniciando por 9.
  if (digitos.length !== 9) return null;
  if (digitos[0] !== "9") return null;
  return `+56${digitos}`;
}

/**
 * True si el input, una vez normalizado, es un celular chileno valido.
 * Thin wrapper sobre normalizarTelefonoCL para legibilidad en guards.
 */
export function esTelefonoCLValido(
  input: string | null | undefined
): boolean {
  return normalizarTelefonoCL(input) !== null;
}

/**
 * Clasifica un telefono para reportes de regularizacion. Util en el
 * dry-run y en la vista administrativa:
 *   - "ausente":      null/vacio.
 *   - "valido":       ya esta en formato canonico +56XXXXXXXXX con 9 inicial.
 *   - "normalizable": no esta en formato canonico, pero normalizarTelefonoCL
 *                     devuelve un valor distinto no nulo.
 *   - "invalido":     tiene contenido pero no se puede normalizar.
 */
export type ClasificacionTelefono =
  | "ausente"
  | "valido"
  | "normalizable"
  | "invalido";

export function clasificarTelefonoCL(
  input: string | null | undefined
): ClasificacionTelefono {
  if (!input) return "ausente";
  const limpio = input.normalize("NFKC").replace(ZERO_WIDTH_RE, "").trim();
  if (!limpio) return "ausente";
  const norm = normalizarTelefonoCL(limpio);
  if (!norm) return "invalido";
  return limpio === norm ? "valido" : "normalizable";
}
