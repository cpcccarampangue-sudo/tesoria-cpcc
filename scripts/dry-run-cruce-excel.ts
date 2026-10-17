// Dry-run del cruce entre la planilla depurada "CPCC_telefonos_familias
// _2026_depurados.xlsx" y los contactos de Supabase PRODUCCION.
//
// REGLAS (requisitos explícitos del usuario):
//   - Cruzamos por CORREO NORMALIZADO. El correo identifica a UNA
//     persona (padre o madre), nunca a la familia. No se asigna un
//     teléfono entre personas distintas por pertenecer a la misma
//     familia.
//   - Candidato a rellenar: contacto Supabase SIN teléfono válido y
//     Excel con teléfono válido para el mismo correo.
//   - NO se reemplazan teléfonos existentes y válidos.
//   - Registros con "Otros números (conflicto)" no vacío en el Excel
//     se marcan como AMBIGUOS y se descartan.
//   - Si un correo del Excel aparece en varios contactos de Supabase,
//     también se descarta (coincidencia múltiple).
//   - Teléfonos en la hoja "Telefonos rechazados" se ignoran (ya
//     vienen marcados como no normalizables).
//
// NO modifica la DB. Produce informe en stdout.
//
// uso: npx tsx scripts/dry-run-cruce-excel.ts "<ruta.xlsx>"

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import {
  normalizarEmail,
  normalizarTelefonoCL,
  clasificarTelefonoCL,
} from "../lib/normalizar";

try {
  const envText = readFileSync(".env.local", "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k]) continue;
    process.env[k] = v.replace(/^["']|["']$/g, "");
  }
} catch {}

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error("uso: npx tsx scripts/dry-run-cruce-excel.ts <ruta.xlsx>");
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) {
  console.error("Faltan credenciales en .env.local");
  process.exit(1);
}
const admin = createClient(SB_URL, SB_SR, {
  auth: { persistSession: false },
});

async function paginar<T>(tabla: string, cols: string): Promise<T[]> {
  const B = 1000;
  const out: T[] = [];
  let d = 0;
  for (;;) {
    const { data, error } = await admin
      .from(tabla)
      .select(cols)
      .range(d, d + B - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    const c = (data as unknown as T[]) ?? [];
    out.push(...c);
    if (c.length < B) break;
    d += B;
  }
  return out;
}

type FilaExcel = {
  familia: string | null;
  persona: string | null;
  emailNorm: string | null;
  telefonoNorm: string | null;
  estado: string | null;
  rolesTexto: string | null;
  conflicto: string | null;
  rawTelefono: string | null;
  rawEmail: string | null;
};

type ContactoDb = {
  id: string;
  apoderado_id: string;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  activo: boolean | null;
};

function textoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function main() {
  console.log("# Dry-run cruce planilla ↔ Supabase (sólo lectura)");
  console.log(`# ${new Date().toISOString()}  xlsx=${xlsxPath}`);
  console.log(`# supabase=${SB_URL}\n`);

  // 1) Leer Excel
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets["Contactos depurados"];
  if (!sheet) {
    throw new Error('Hoja "Contactos depurados" no encontrada en el XLSX.');
  }
  const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  const filas: FilaExcel[] = rowsRaw.map((r) => {
    const rawEmail = textoOrNull(r["Correo normalizado"]);
    const rawTel = textoOrNull(r["Teléfono +56"]);
    return {
      familia: textoOrNull(r["Familia"]),
      persona: textoOrNull(r["Persona"]),
      emailNorm: normalizarEmail(rawEmail),
      telefonoNorm: normalizarTelefonoCL(rawTel),
      estado: textoOrNull(r["Estado"]),
      rolesTexto: textoOrNull(r["Roles en archivo"]),
      conflicto: textoOrNull(r["Otros números (conflicto)"]),
      rawTelefono: rawTel,
      rawEmail,
    };
  });

  console.log(`Excel: ${filas.length} filas en "Contactos depurados"\n`);

  // 2) Resumen Excel: cuántas filas aportan algo
  const conEmail = filas.filter((f) => f.emailNorm !== null).length;
  const conTel = filas.filter((f) => f.telefonoNorm !== null).length;
  const conConflicto = filas.filter((f) => f.conflicto !== null).length;
  const aptas = filas.filter(
    (f) =>
      f.emailNorm !== null && f.telefonoNorm !== null && f.conflicto === null
  );
  console.log("## Excel");
  console.log(`  filas con correo normalizable:  ${conEmail}`);
  console.log(`  filas con teléfono normalizable: ${conTel}`);
  console.log(`  filas con conflicto (otros nros): ${conConflicto}`);
  console.log(`  filas aptas (email + tel + sin conflicto): ${aptas.length}\n`);

  // 3) Agregar por email: una persona puede aparecer en varias filas
  //    (por hermanos). Si todas tienen el mismo teléfono normalizado y
  //    sin conflicto, agrupamos y lo tratamos como un solo registro
  //    "persona por email".
  type PersonaExcel = {
    emailNorm: string;
    telefonoNorm: string;
    familias: Set<string>;
    personas: Set<string>;
    tieneConflicto: boolean;
    filas: number;
  };
  const porEmail = new Map<string, PersonaExcel>();
  for (const f of aptas) {
    if (!f.emailNorm || !f.telefonoNorm) continue;
    const p = porEmail.get(f.emailNorm);
    if (!p) {
      porEmail.set(f.emailNorm, {
        emailNorm: f.emailNorm,
        telefonoNorm: f.telefonoNorm,
        familias: new Set([f.familia ?? ""]),
        personas: new Set([f.persona ?? ""]),
        tieneConflicto: false,
        filas: 1,
      });
    } else {
      p.filas++;
      p.familias.add(f.familia ?? "");
      p.personas.add(f.persona ?? "");
      // Si para el mismo email aparecen teléfonos distintos entre filas,
      // es conflicto interno.
      if (p.telefonoNorm !== f.telefonoNorm) p.tieneConflicto = true;
    }
  }
  // Marcar emails con conflicto por filas rechazadas en la misma persona.
  for (const f of filas) {
    if (f.emailNorm && f.conflicto) {
      const p = porEmail.get(f.emailNorm);
      if (p) p.tieneConflicto = true;
    }
  }

  // 4) Cargar contactos de Supabase
  const contactos = await paginar<ContactoDb>(
    "contactos",
    "id, apoderado_id, nombre, email, telefono, activo"
  );
  const activos = contactos.filter((c) => c.activo !== false);
  console.log(`## Supabase`);
  console.log(`  contactos totales:  ${contactos.length}`);
  console.log(`  contactos activos:  ${activos.length}`);

  // Indexar activos por email_norm (unique por indice idx_contactos_email_unique)
  const sbPorEmail = new Map<string, ContactoDb[]>();
  for (const c of activos) {
    const en = normalizarEmail(c.email);
    if (!en) continue;
    const arr = sbPorEmail.get(en) ?? [];
    arr.push(c);
    sbPorEmail.set(en, arr);
  }
  const sinTelefono = activos.filter(
    (c) => clasificarTelefonoCL(c.telefono) !== "valido"
  );
  const sinTelefonoYConEmail = sinTelefono.filter(
    (c) => normalizarEmail(c.email) !== null
  );
  console.log(`  sin teléfono válido: ${sinTelefono.length}`);
  console.log(`    de ellos con email registrado: ${sinTelefonoYConEmail.length}\n`);

  // 5) Cruce
  type Candidato = {
    contactoId: string;
    apoderadoId: string;
    contactoNombre: string | null;
    emailMatch: string;
    telefonoNuevo: string;
    personasExcel: string[];
    familiasExcel: string[];
  };
  const candidatos: Candidato[] = [];
  const emailDuplicadoSb: string[] = [];
  const emailConflictoExcel: string[] = [];
  const emailSinMatchEnExcel: string[] = [];

  for (const c of sinTelefonoYConEmail) {
    const en = normalizarEmail(c.email)!;
    // Si el email aparece en varios contactos de Supabase (no deberia
    // por unique, pero defendemos igual), descartamos.
    const sbList = sbPorEmail.get(en) ?? [];
    if (sbList.length > 1) {
      emailDuplicadoSb.push(en);
      continue;
    }
    const px = porEmail.get(en);
    if (!px) {
      emailSinMatchEnExcel.push(en);
      continue;
    }
    if (px.tieneConflicto) {
      emailConflictoExcel.push(en);
      continue;
    }
    candidatos.push({
      contactoId: c.id,
      apoderadoId: c.apoderado_id,
      contactoNombre: c.nombre,
      emailMatch: en,
      telefonoNuevo: px.telefonoNorm,
      personasExcel: [...px.personas],
      familiasExcel: [...px.familias],
    });
  }

  console.log("## Resultado del cruce\n");
  console.log(
    `  Contactos sin teléfono con email registrado:    ${sinTelefonoYConEmail.length}`
  );
  console.log(
    `  Coincidencias confiables (candidatos a rellenar): ${candidatos.length}`
  );
  console.log(
    `  Descartados por conflicto en el Excel:            ${emailConflictoExcel.length}`
  );
  console.log(
    `  Descartados por aparecer en varios contactos SB:  ${emailDuplicadoSb.length}`
  );
  console.log(
    `  Sin match (email no está en el Excel):            ${emailSinMatchEnExcel.length}`
  );
  console.log(
    `  Contactos sin teléfono y SIN email (no cruzables): ${
      sinTelefono.length - sinTelefonoYConEmail.length
    }\n`
  );

  // 6) Proyeccion post-aplicacion
  const quedarianSinTel = activos.length - (
    activos.filter((c) => clasificarTelefonoCL(c.telefono) === "valido").length +
    candidatos.length
  );
  console.log("## Proyección si se aplican todos los candidatos\n");
  console.log(
    `  Contactos activos con teléfono válido ahora:       ${activos.filter((c) => clasificarTelefonoCL(c.telefono) === "valido").length}`
  );
  console.log(`  Se agregarían:                                     ${candidatos.length}`);
  console.log(`  Quedarían sin teléfono (sin email o sin match):    ${quedarianSinTel}\n`);

  // 7) Ejemplos
  console.log("## Ejemplos de coincidencias (datos enmascarados)\n");
  for (const c of candidatos.slice(0, 10)) {
    const u4 = c.telefonoNuevo.slice(-4);
    const emailShown = c.emailMatch.replace(
      /^(.)(.*?)(@.+)$/,
      (_, a, b, d) => `${a}${"*".repeat(Math.min(5, b.length))}${d}`
    );
    console.log(
      `  contacto=${c.contactoId.slice(0, 8)}…  email=${emailShown}  nuevo=+56…${u4}  (persona Excel: "${c.personasExcel[0] ?? "-"}")`
    );
  }
  if (candidatos.length > 10) {
    console.log(`  … y ${candidatos.length - 10} más.\n`);
  } else {
    console.log("");
  }

  if (emailConflictoExcel.length > 0) {
    console.log("## Primeros emails descartados por conflicto en Excel\n");
    for (const e of emailConflictoExcel.slice(0, 10)) {
      const shown = e.replace(
        /^(.)(.*?)(@.+)$/,
        (_, a, b, d) => `${a}${"*".repeat(Math.min(5, b.length))}${d}`
      );
      console.log(`  - ${shown}`);
    }
    console.log("");
  }

  console.log("Fin dry-run.\n");
}

main().catch((err) => {
  console.error("dry-run fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
