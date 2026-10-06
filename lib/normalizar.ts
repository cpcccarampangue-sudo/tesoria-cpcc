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
