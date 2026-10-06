// Tipos para el flujo admin de socios. Separado de actions.ts porque los
// archivos "use server" solo pueden exportar funciones async.
//
// La diferencia con los tipos publicos de /incorporacion es que aqui NO
// enmascaramos nada: el admin esta autenticado y necesita ver los datos
// completos para hacer su trabajo (incorporar socio, confirmar pago manual).

import type { Apoderado, Contacto, Estudiante } from "@/lib/types";

export type FamiliaCandidataAdmin = {
  apoderado: Apoderado;
  contactos: Contacto[];
  estudiantes: Estudiante[];
  yaSocioToken: string | null;
};

export type ResultadoBusquedaAdmin = {
  familias: FamiliaCandidataAdmin[];
  hayMas: boolean;
};
