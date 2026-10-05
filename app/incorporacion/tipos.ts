// Tipos y helpers sincronos del flujo /incorporacion. En archivo separado
// porque actions.ts es "use server" y Next.js no permite exportar funciones
// sincronicas desde modulos server actions.

import type { Apoderado, Contacto, Estudiante } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type TipoBusqueda = "email" | "nombre";

export type FamiliaCandidata = {
  apoderado: Apoderado;
  contactos: Contacto[];
  estudiantes: Estudiante[];
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
