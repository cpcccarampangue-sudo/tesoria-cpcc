// Lista completa de cursos del colegio, desde Prekinder hasta 4° Medio con
// letras A, B y C por nivel. Compartida por certificados y por el modulo
// de incorporacion de socios para que el select siempre tenga las mismas
// opciones. Si cambia la oferta curricular, se actualiza aqui.

export type CursoGrupo = {
  nombre: string;
  niveles: string[];
};

export const CURSO_GRUPOS: CursoGrupo[] = [
  { nombre: "Educación Parvularia", niveles: ["Prekinder", "Kinder"] },
  {
    nombre: "Enseñanza Básica",
    niveles: [
      "1° Básico",
      "2° Básico",
      "3° Básico",
      "4° Básico",
      "5° Básico",
      "6° Básico",
      "7° Básico",
      "8° Básico",
    ],
  },
  {
    nombre: "Enseñanza Media",
    niveles: ["1° Medio", "2° Medio", "3° Medio", "4° Medio"],
  },
];

export const CURSO_LETRAS = ["A", "B", "C"] as const;

// Todas las combinaciones posibles como strings, p.ej. "5° Básico B".
// Util para validaciones en el servidor.
export function todosLosCursos(): string[] {
  const out: string[] = [];
  for (const grupo of CURSO_GRUPOS) {
    for (const nivel of grupo.niveles) {
      for (const letra of CURSO_LETRAS) {
        out.push(`${nivel} ${letra}`);
      }
    }
  }
  return out;
}
