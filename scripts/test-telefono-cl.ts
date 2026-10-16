// Script de prueba manual para normalizarTelefonoCL y clasificarTelefonoCL.
// Ejecutar: `npx ts-node scripts/test-telefono-cl.ts` o `tsx scripts/...`
// Si no se dispone de runner TS, puede compilarse con `tsc` o importarse
// desde un script Node temporal. Es solo para validar reglas localmente.

import {
  normalizarTelefonoCL,
  esTelefonoCLValido,
  clasificarTelefonoCL,
} from "../lib/normalizar";

type Caso = {
  entrada: string | null | undefined;
  esperadoNorm: string | null;
  esperadoClase: "ausente" | "valido" | "normalizable" | "invalido";
  descripcion: string;
};

const CASOS: Caso[] = [
  // Formato canonico ya correcto
  {
    entrada: "+56955282630",
    esperadoNorm: "+56955282630",
    esperadoClase: "valido",
    descripcion: "canonico, pasa igual",
  },
  // Formatos normalizables comunes
  {
    entrada: "955282630",
    esperadoNorm: "+56955282630",
    esperadoClase: "normalizable",
    descripcion: "9 digitos con 9 inicial",
  },
  {
    entrada: "56955282630",
    esperadoNorm: "+56955282630",
    esperadoClase: "normalizable",
    descripcion: "con 56 sin +",
  },
  {
    entrada: "+56 9 5528 2630",
    esperadoNorm: "+56955282630",
    esperadoClase: "normalizable",
    descripcion: "con espacios",
  },
  {
    entrada: "+56-9-5528-2630",
    esperadoNorm: "+56955282630",
    esperadoClase: "normalizable",
    descripcion: "con guiones",
  },
  {
    entrada: "(+56) 9 5528 2630",
    esperadoNorm: "+56955282630",
    esperadoClase: "normalizable",
    descripcion: "con parentesis",
  },
  // Invalidos
  {
    entrada: "22345678",
    esperadoNorm: null,
    esperadoClase: "invalido",
    descripcion: "8 digitos (incompleto)",
  },
  {
    entrada: "223456789",
    esperadoNorm: null,
    esperadoClase: "invalido",
    descripcion: "9 digitos pero no empieza con 9 (fijo)",
  },
  {
    entrada: "+56 2 2345 6789",
    esperadoNorm: null,
    esperadoClase: "invalido",
    descripcion: "fijo chileno de 9 digitos",
  },
  {
    entrada: "9999999999",
    esperadoNorm: null,
    esperadoClase: "invalido",
    descripcion: "10 digitos (sin prefijo 56)",
  },
  {
    entrada: "abc",
    esperadoNorm: null,
    esperadoClase: "invalido",
    descripcion: "solo letras",
  },
  // Ausentes
  {
    entrada: "",
    esperadoNorm: null,
    esperadoClase: "ausente",
    descripcion: "cadena vacia",
  },
  {
    entrada: "   ",
    esperadoNorm: null,
    esperadoClase: "ausente",
    descripcion: "solo espacios",
  },
  {
    entrada: null,
    esperadoNorm: null,
    esperadoClase: "ausente",
    descripcion: "null",
  },
  {
    entrada: undefined,
    esperadoNorm: null,
    esperadoClase: "ausente",
    descripcion: "undefined",
  },
];

let okCount = 0;
let failCount = 0;
const fallos: string[] = [];

for (const c of CASOS) {
  const normResult = normalizarTelefonoCL(c.entrada);
  const claseResult = clasificarTelefonoCL(c.entrada);
  const normOk = normResult === c.esperadoNorm;
  const claseOk = claseResult === c.esperadoClase;
  const validOk =
    esTelefonoCLValido(c.entrada) === (c.esperadoNorm !== null);
  if (normOk && claseOk && validOk) {
    okCount++;
  } else {
    failCount++;
    fallos.push(
      `FAIL [${c.descripcion}] entrada=${JSON.stringify(c.entrada)}\n` +
        `  norm esperado=${JSON.stringify(c.esperadoNorm)} obtenido=${JSON.stringify(normResult)}\n` +
        `  clase esperada=${c.esperadoClase} obtenida=${claseResult}\n` +
        `  esValido esperado=${c.esperadoNorm !== null} obtenido=${esTelefonoCLValido(c.entrada)}`
    );
  }
}

console.log(`\nResumen: ${okCount}/${CASOS.length} OK, ${failCount} fallos.`);
if (fallos.length > 0) {
  console.log("\n" + fallos.join("\n\n"));
  process.exit(1);
}
process.exit(0);
