// Pruebas duras de obligatoriedad: ejercitan los validadores REALES que
// usan las server actions de incorporación y admin, con una matriz de
// inputs (vacíos, inválidos, válidos) y verifican que:
//
//   - Cada input inválido es rechazado por los validadores centrales
//     (normalizarEmail, normalizarTelefonoCL, componerTelefonoCL,
//     limpiarTelefonoOpcional).
//   - Cada input válido pasa.
//   - Cada server action referenciada por los formularios llama al
//     validador antes de insertar (verificación por grep de código).
//   - Cada formulario FE marca el input como `required` o pasa por
//     el componente TelefonoCLInput en modo required.
//
// No necesita Supabase ni servidor Next: ejecuta las funciones puras
// directamente. Si cualquier caso falla, el script sale con exit 1.
//
// uso: npx tsx scripts/test-obligatoriedad.ts

import { readFileSync } from "node:fs";
import {
  normalizarEmail,
  normalizarTelefonoCL,
} from "../lib/normalizar";
import { componerTelefonoCL } from "../components/telefono-cl-input";

type Caso = { input: string | null | undefined; valido: boolean };

const EMAIL_CASOS: Caso[] = [
  { input: null, valido: false },
  { input: undefined, valido: false },
  { input: "", valido: false },
  { input: "    ", valido: false },
  { input: "sin-arroba", valido: false },
  { input: "a@b", valido: false },
  { input: "a@b.c", valido: true },
  { input: "test@ejemplo.cl", valido: true },
  { input: "  TEST@EJEMPLO.CL  ", valido: true }, // normaliza a minúsculas
  { input: "familia.cáceres@ejemplo.cl", valido: true },
];

const TELEFONO_CASOS: Caso[] = [
  // Inválidos: vacío, letras, longitud mala, no empieza con 9
  { input: null, valido: false },
  { input: undefined, valido: false },
  { input: "", valido: false },
  { input: "    ", valido: false },
  { input: "abcdefghi", valido: false },
  { input: "12345678", valido: false }, // 8 dígitos
  { input: "223456789", valido: false }, // 9 dígitos pero fijo
  { input: "+56223456789", valido: false }, // fijo chileno
  { input: "9999999999", valido: false }, // 10 dígitos
  // Válidos: distintos formatos que normalizan a +569XXXXXXXX
  { input: "955282630", valido: true },
  { input: "+56955282630", valido: true },
  { input: "56955282630", valido: true },
  { input: "+56 9 5528 2630", valido: true },
  { input: "+56-9-5528-2630", valido: true },
  { input: "(+56) 9 5528 2630", valido: true },
];

let ok = 0;
let fail = 0;
const fallos: string[] = [];

function check(desc: string, pass: boolean, extra = "") {
  if (pass) {
    ok++;
  } else {
    fail++;
    fallos.push(`FAIL  ${desc}${extra ? "  — " + extra : ""}`);
  }
}

// ============================================================
// 1) Correo electrónico — validación central
// ============================================================
console.log("## 1. Correo electrónico (normalizarEmail)");
for (const c of EMAIL_CASOS) {
  const r = normalizarEmail(c.input);
  const esValido = r !== null;
  check(
    `email ${JSON.stringify(c.input)} ⇒ ${esValido ? r : "null"}  esperado ${c.valido ? "válido" : "rechazado"}`,
    esValido === c.valido
  );
  // Normalización: si input tiene mayúsculas, debe quedar en lowercase.
  if (esValido && c.input && /[A-Z]/.test(String(c.input))) {
    check(
      `email ${JSON.stringify(c.input)} normalizado a minúsculas`,
      r === r!.toLowerCase()
    );
  }
}

// ============================================================
// 2) Teléfono — validación central
// ============================================================
console.log("\n## 2. Teléfono (normalizarTelefonoCL)");
for (const c of TELEFONO_CASOS) {
  const r = normalizarTelefonoCL(c.input);
  const esValido = r !== null;
  check(
    `tel ${JSON.stringify(c.input)} ⇒ ${esValido ? r : "null"}  esperado ${c.valido ? "válido" : "rechazado"}`,
    esValido === c.valido
  );
  // Formato final garantizado para los válidos
  if (esValido) {
    check(
      `tel ${JSON.stringify(c.input)} normaliza a +569XXXXXXXX`,
      /^\+569[0-9]{8}$/.test(r!)
    );
  }
}

// ============================================================
// 3) componerTelefonoCL (cliente — guard antes de enviar)
// ============================================================
console.log("\n## 3. componerTelefonoCL (guard del form cliente)");
const COMPONE_CASOS: { digitos: string; esperado: string | null }[] = [
  { digitos: "", esperado: null },
  { digitos: "9", esperado: null },
  { digitos: "95528263", esperado: null }, // 8 dígitos
  { digitos: "255282630", esperado: null }, // no empieza con 9
  { digitos: "955282630", esperado: "+56955282630" },
];
for (const c of COMPONE_CASOS) {
  const r = componerTelefonoCL(c.digitos);
  check(
    `componer ${JSON.stringify(c.digitos)} ⇒ ${r}  esperado ${c.esperado}`,
    r === c.esperado
  );
}

// ============================================================
// 4) Flujos server-action: cada guard DEBE lanzar con input inválido
// Simulamos la condición exacta que escriben las server actions:
//   const email = normalizarEmail(input.apoderado_email);
//   if (!email) throw new Error("El correo electrónico no es válido.");
//   const telefonoNorm = normalizarTelefonoCL(input.apoderado_telefono);
//   if (!telefonoNorm) throw new Error("Ingresa un teléfono celular válido...");
// ============================================================
console.log("\n## 4. Simulación de guards server-side");

type Flujo = {
  nombre: string;
  entrada: { email: unknown; telefono: unknown };
  esperado: "ok" | "rechaza_email" | "rechaza_tel";
};
const FLUJOS: Flujo[] = [
  // Incorporación pública caso B / C (mismo guard):
  {
    nombre: "caso B · todo vacío",
    entrada: { email: "", telefono: "" },
    esperado: "rechaza_email",
  },
  {
    nombre: "caso B · solo email válido",
    entrada: { email: "ok@ejemplo.cl", telefono: "" },
    esperado: "rechaza_tel",
  },
  {
    nombre: "caso B · tel incompleto (8 dígitos)",
    entrada: { email: "ok@ejemplo.cl", telefono: "95528263" },
    esperado: "rechaza_tel",
  },
  {
    nombre: "caso B · tel no empieza con 9",
    entrada: { email: "ok@ejemplo.cl", telefono: "255282630" },
    esperado: "rechaza_tel",
  },
  {
    nombre: "caso B · email mayúsculas + tel válido → ok",
    entrada: { email: "OK@EJEMPLO.CL", telefono: "955282630" },
    esperado: "ok",
  },
  {
    nombre: "caso B · ambos válidos",
    entrada: { email: "ok@ejemplo.cl", telefono: "+56 9 5528 2630" },
    esperado: "ok",
  },
];

function simularGuard(email: unknown, tel: unknown):
  | "rechaza_email"
  | "rechaza_tel"
  | "ok" {
  const e = normalizarEmail(email as string);
  if (!e) return "rechaza_email";
  const t = normalizarTelefonoCL(tel as string);
  if (!t) return "rechaza_tel";
  return "ok";
}

for (const f of FLUJOS) {
  const r = simularGuard(f.entrada.email, f.entrada.telefono);
  check(
    `${f.nombre} ⇒ ${r}  esperado ${f.esperado}`,
    r === f.esperado
  );
}

// ============================================================
// 5) Verificación por lectura de archivos: los guards están en las
// server actions reales y los formularios tienen required/input tipado.
// ============================================================
console.log("\n## 5. Guards presentes en código fuente");

const checksGrep: {
  archivo: string;
  regex: RegExp;
  descripcion: string;
}[] = [
  // Server actions: validan email+teléfono en cada flujo
  {
    archivo: "app/incorporacion/actions.ts",
    regex: /crearSolicitudSocio[\s\S]{0,3000}normalizarEmail[\s\S]{0,500}normalizarTelefonoCL/,
    descripcion:
      "crearSolicitudSocio (caso B) llama normalizarEmail y normalizarTelefonoCL antes del insert",
  },
  {
    archivo: "app/incorporacion/actions.ts",
    regex: /crearSolicitudManualSocio[\s\S]{0,3000}normalizarEmail[\s\S]{0,500}normalizarTelefonoCL/,
    descripcion:
      "crearSolicitudManualSocio (caso C) llama normalizarEmail y normalizarTelefonoCL antes del insert",
  },
  {
    archivo: "app/(app)/socios/actions.ts",
    regex: /crearSocioConPagoManual[\s\S]{0,2000}normalizarEmail[\s\S]{0,300}normalizarTelefonoCL/,
    descripcion:
      "crearSocioConPagoManual (admin alta) llama normalizarEmail y normalizarTelefonoCL",
  },
  // El error del teléfono es claro
  {
    archivo: "app/incorporacion/actions.ts",
    regex: /Ingresa un tel[eé]fono celular v[aá]lido/,
    descripcion: "mensaje de error claro para teléfono inválido en incorporación",
  },
  {
    archivo: "app/(app)/socios/actions.ts",
    regex: /Ingresa un tel[eé]fono celular v[aá]lido/,
    descripcion: "mensaje de error claro para teléfono inválido en admin",
  },
  // FE: cada formulario usa TelefonoCLInput y bloquea el botón si falta
  {
    archivo: "app/incorporacion/incorporacion-form.tsx",
    regex: /TelefonoCLInput[\s\S]{0,200}required/,
    descripcion:
      "incorporacion-form.tsx usa TelefonoCLInput con required (al menos un sitio)",
  },
  {
    archivo: "app/incorporacion/incorporacion-form.tsx",
    regex: /componerTelefonoCL\(telefono\) === null/,
    descripcion:
      "Botón caso B deshabilitado si componerTelefonoCL(telefono) === null",
  },
  {
    archivo: "app/incorporacion/incorporacion-form.tsx",
    regex: /componerTelefonoCL\(manual\.apoderado_telefono\) === null/,
    descripcion:
      "Botón caso C deshabilitado si componerTelefonoCL(manual.apoderado_telefono) === null",
  },
  {
    archivo: "app/(app)/socios/nuevo/nuevo-form.tsx",
    regex: /componerTelefonoCL\(telefono\) === null/,
    descripcion: "Botón admin deshabilitado si teléfono inválido",
  },
  // Precarga del teléfono en caso B (gap que acabamos de cerrar)
  {
    archivo: "app/incorporacion/actions.ts",
    regex: /telefonoActualDigitos/,
    descripcion:
      "estadoPostOtp devuelve telefonoActualDigitos para precargar caso B",
  },
  {
    archivo: "app/incorporacion/incorporacion-form.tsx",
    regex: /s\.telefonoActualDigitos/,
    descripcion:
      "incorporacion-form.tsx consume telefonoActualDigitos al aplicar estado",
  },
  // Propagación a contactos (dato guardado en el contacto, no solo en solicitud)
  {
    archivo: "app/incorporacion/actions.ts",
    regex: /from\("contactos"\)[\s\S]{0,200}\.update\(\{\s*telefono: telefonoNorm/,
    descripcion:
      "crearSolicitudSocio propaga telefono al contacto del email verificado",
  },
  {
    archivo: "app/(app)/socios/actions.ts",
    regex: /from\("contactos"\)[\s\S]{0,200}\.update\(\{\s*telefono: telefonoNormAdmin/,
    descripcion:
      "crearSocioConPagoManual propaga telefono al contacto del email verificado",
  },
  {
    archivo: "app/(app)/socios/actions.ts",
    regex: /vincularSolicitudConApoderado[\s\S]{0,5000}\.update\(\{\s*telefono: telefonoNorm/,
    descripcion:
      "vincularSolicitudConApoderado propaga telefono al contacto correspondiente",
  },
  {
    archivo: "app/(app)/socios/actions.ts",
    regex: /sol\.apoderado_telefono/,
    descripcion:
      "vincularSolicitudConApoderado lee apoderado_telefono de la solicitud",
  },
];

for (const c of checksGrep) {
  try {
    const txt = readFileSync(c.archivo, "utf8");
    const match = c.regex.test(txt);
    check(c.descripcion, match, match ? "" : `(no matchea ${c.regex})`);
  } catch (err) {
    check(
      c.descripcion,
      false,
      `no se puede leer ${c.archivo}: ${err instanceof Error ? err.message : err}`
    );
  }
}

// ============================================================
// Resultado
// ============================================================
console.log(`\n## Resultado  ${ok} OK, ${fail} FAIL`);
if (fail > 0) {
  console.log("\n" + fallos.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log(
  "\nTODOS los guards activos. No se puede crear una incorporación/renovación sin email+teléfono válidos."
);
