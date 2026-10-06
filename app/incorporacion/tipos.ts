// Tipos y helpers sincronos del flujo /incorporacion. En archivo separado
// porque actions.ts es "use server" y Next.js no permite exportar funciones
// sincronicas desde modulos server actions.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type TipoBusqueda = "email" | "nombre";

// Vista MINIMIZADA de la familia que viaja al cliente publico. Datos
// personales (nombres, correos) van enmascarados para evitar enumeracion
// y exposicion. El UUID del apoderado si viaja porque es aleatorio y se
// usa para identificar la siguiente peticion al crear la solicitud.
export type FamiliaCandidata = {
  apoderadoId: string;
  apoderadoNombreMask: string;
  // Lista reducida: solo email enmascarado, para que el usuario reconozca
  // "si es mi familia" sin exponer correos reales de otras personas.
  contactosMask: Array<{ emailMask: string }>;
  // Alumnos: nombre enmascarado + curso (el curso no es sensible).
  estudiantes: Array<{
    id: string;
    nombreMask: string;
    curso: string | null;
  }>;
  // Si la familia ya es socia activa del periodo vigente, el token del
  // QR existente para mostrarlo en vez del formulario de pago.
  yaSocioToken: string | null;
};

export type ResultadoBusqueda = {
  tipo: TipoBusqueda;
  familias: FamiliaCandidata[];
  // true si hay mas resultados que los devueltos (hay que refinar).
  hayMas: boolean;
};

// Decide que tipo de busqueda hacer segun lo que viene del usuario.
// Correo (contiene @ con formato valido) o nombre/apellido (cualquier otro).
export function detectarTipoBusqueda(input: string): TipoBusqueda {
  const trimmed = input.trim();
  if (trimmed.includes("@") && EMAIL_RE.test(trimmed)) return "email";
  return "nombre";
}

/**
 * Enmascara una cadena mostrando la primera y ultima letra visibles y
 * reemplazando el medio con bullets. Ej: "Caceres" -> "C•••••s".
 * Palabras muy cortas se mantienen primera letra + bullet.
 */
export function maskPalabra(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length === 1) return trimmed + "•";
  if (trimmed.length === 2) return trimmed[0] + "•";
  const inner = "•".repeat(Math.max(2, trimmed.length - 2));
  return trimmed[0] + inner + trimmed[trimmed.length - 1];
}

/**
 * Enmascara un nombre completo preservando iniciales. Util para
 * mostrarle al apoderado datos suficientes para reconocer que es su
 * familia sin exponer a terceros.
 */
export function maskNombre(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map(maskPalabra)
    .join(" ");
}

/**
 * Enmascara un correo manteniendo el dominio visible pero ocultando la
 * mayor parte del local. "pamela.rodriguez@gmail.com" -> "p•••••••@gmail.com"
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at < 1) return "•••@•••";
  const local = trimmed.slice(0, at);
  const dominio = trimmed.slice(at);
  if (local.length <= 2) return local[0] + "•" + dominio;
  return local[0] + "•".repeat(Math.min(6, local.length - 1)) + dominio;
}
