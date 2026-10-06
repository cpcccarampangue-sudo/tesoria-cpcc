// Helpers de normalizacion de inputs del usuario. Centralizados para que
// el frontend y el servidor apliquen EXACTAMENTE la misma transformacion
// antes de comparar con lo que vive en base de datos.
//
// Si el frontend normaliza y el server normaliza distinto (o uno no
// normaliza), aparecen bugs del tipo "en desktop encuentra, en mobile no".

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normaliza un correo electronico de forma determinista:
 *   1. normalize("NFKC") — unifica variantes Unicode (ej. ligaduras,
 *      caracteres de ancho completo que algunos teclados moviles usan).
 *   2. elimina caracteres de control y zero-width del inicio/fin.
 *   3. trim() de espacios estandar.
 *   4. toLowerCase() porque los dominios de correo son case-insensitive
 *      y en la practica tratamos el local-part tambien asi.
 *
 * El resultado es una cadena lista para comparar contra la base. Si no
 * paso la validacion basica de formato, devuelve null.
 */
export function normalizarEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  // NFKC primero: unifica caracteres equivalentes (eg "ｅ" fullwidth -> "e")
  let s = input.normalize("NFKC");
  // Reemplaza caracteres zero-width/invisibles mas comunes.
  // U+200B zero-width space, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM.
  s = s.replace(/[​‌‍﻿]/g, "");
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
    .replace(/[​‌‍﻿]/g, "")
    .trim()
    .toLowerCase();
}
