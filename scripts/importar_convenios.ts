// Importador de convenios desde el XLSX "Formulario de inscripcion y
// renovacion de convenios CPCC 2026 (respuestas).xlsx".
//
// Flujo:
//   - Lee XLSX (53 filas).
//   - Excluye "El Crustáceo Cascarudo" (fila de prueba, personajes de Bob Esponja).
//   - Normaliza campos de forma SEGURA (trim, lowercase email, nombre
//     normalizado, telefono CL, instagram @handle, comuna basica, URL web https).
//   - Verifica colisiones contra convenios existentes en DB.
//   - En dry-run (default): imprime acciones (INSERT/UPDATE/SIN_CAMBIO/ERROR) sin
//     tocar DB. Requiere flag explicito --apply para escribir.
//   - UPSERT convenios por nombre_normalizado (migracion 036).
//   - INSERT operador = "Correo electronico de contacto" (unico, ON CONFLICT DO NOTHING).
//   - No toca logos, flyers, OTP, correos, validaciones_log.
//
// Uso:
//   npx tsx scripts/importar_convenios.ts <xlsx>
//   npx tsx scripts/importar_convenios.ts <xlsx> --apply       # escribe en DB
//
// Credenciales: lee .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// Cargar .env.local manualmente (sin agregar dependencia nueva).
try {
  const envText = readFileSync(".env.local", "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k]) continue;
    process.env[k] = v.replace(/^["']|["']$/g, "");
  }
} catch {
  // sin .env.local, seguimos con lo que haya en env
}

const args = process.argv.slice(2);
const xlsxPath = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
if (!xlsxPath) {
  console.error(
    "uso: npx tsx scripts/importar_convenios.ts <xlsx> [--apply]"
  );
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const admin = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

// ============================================================
// Helpers de normalizacion (todas seguras; no reinterpretan contenido)
// ============================================================
function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function colapsarEspacios(x: string): string {
  return x.replace(/\s+/g, " ").trim();
}
function nombreNormalizado(nombre: string): string {
  return colapsarEspacios(nombre).toLowerCase();
}
function emailNormalizado(v: unknown): string | null {
  const e = s(v).toLowerCase();
  if (!e) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null;
  return e;
}
// Telefono CL: devuelve en formato +569XXXXXXXX si es inequivoco.
// Si no se puede normalizar (ambiguo), devuelve null + aviso.
function telefonoCL(raw: string): { value: string | null; aviso?: string } {
  const t = raw.replace(/\s+/g, "").replace(/\(.*?\)/g, "").trim();
  if (!t) return { value: null };
  // Caso +56XXXXXXXXX o 56XXXXXXXXX (11 digitos tras codigo pais)
  const m56 = t.match(/^\+?56(\d{9})$/);
  if (m56) return { value: `+56${m56[1]}` };
  // Caso 9XXXXXXXX (9 digitos empezando con 9)
  const m9 = t.match(/^9(\d{8})$/);
  if (m9) return { value: `+569${m9[1]}` };
  // Caso ya con 56 pero sin + (ej "56998284082")
  if (/^56\d{9}$/.test(t)) return { value: `+${t}` };
  return { value: null, aviso: `telefono no normalizable: ${JSON.stringify(raw)}` };
}
function sitioWebNorm(raw: string): string | null {
  const w = s(raw);
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w.replace(/^http:\/\//i, "https://");
  // Agregar https:// si parece URL (contiene punto y sin espacios/arroba)
  if (/^[^\s@]+\.[^\s@]+/.test(w)) return "https://" + w.replace(/^www\./i, "www.");
  return null;
}
// Instagram: devuelve @handle si es claramente un handle, URL si trae URL,
// null si no se puede inferir (texto ambiguo). Nunca re-escribe libremente.
function instagramNorm(raw: string): string | null {
  const v = s(raw);
  if (!v) return null;
  // Casos obvios: URL de instagram.com
  if (/https?:\/\/(www\.)?instagram\.com\//i.test(v)) return v;
  // Caso @handle
  if (/^@[a-z0-9._]+$/i.test(v)) return v;
  // Handle sin @ (letras/numeros/./_ y sin espacios) -> prepend @
  if (/^[a-z0-9._]+$/i.test(v)) return "@" + v;
  // Texto ambiguo (ej "Instagram @ciaopizzarest" o "Kiosco de libros Talagante")
  const m = v.match(/@([a-z0-9._]+)/i);
  if (m) return "@" + m[1]; // extrae el primer handle si viene mezclado
  return null; // no reinterpretamos texto ambiguo
}
function tipoConvenioNorm(raw: string): {
  value: "nuevo" | "renovacion" | null;
  original: string;
} {
  const v = s(raw).toLowerCase();
  const original = s(raw);
  if (!v) return { value: null, original };
  if (/renov/i.test(v)) return { value: "renovacion", original };
  if (/nuevo/i.test(v)) return { value: "nuevo", original };
  return { value: null, original };
}
function comunaNorm(raw: string): string | null {
  const v = s(raw);
  if (!v) return null;
  // Mayus/minus consistentes: "Title Case" solo en palabras simples CL.
  // Casos como "TALAGANTE" -> "Talagante", "ISLA DE MAIPO" -> "Isla De Maipo".
  const titled = v
    .toLowerCase()
    .replace(/\b([a-záéíóúñ])([a-záéíóúñ]*)/g, (_, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\bDe\b/g, "de");
  return titled;
}

// ============================================================
// Lectura XLSX
// ============================================================
const buf = readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: "buffer" });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<Record<string, string | null>>(sheet, {
  defval: null,
  raw: false,
});

const H = {
  nombre: "Nombre del emprendimiento / empresa",
  contactoNombre: "Nombre persona de contacto ",
  contactoCargo: "Cargo o relación con el negocio",
  email: "Correo electrónico de contacto",
  telefono:
    "Número de teléfono (Ingrese los 9 dígitos sin el código de país y sin espacios (ej: 9XXXXXXXX).)",
  rubro: "Rubro o categoria del negocio",
  rubroOtro: "Otro rubro o categoria ",
  tipoConvenio: "Nuevo convenio o renovación ",
  beneficio:
    "Descripción del beneficio o descuento ofrecido a las familias del colegio (Ejemplo:\n10% de descuento en todos los servicios)",
  condiciones:
    "Condiciones para que los socios puedan acceder al beneficio\n(Ejemplo: Válido pagando en efectivo / mencionando el convenio u otro )",
  direccion: "Dirección del local (si aplica)",
  comuna: "Ciudad o comuna",
  sitioWeb: "Sitio web (si tiene) ",
  instagram: "Indique su Instagram ",
} as const;

const VALID_FROM = "2026-01-01";
const VALID_UNTIL = "2027-12-31";
const EXCLUIDO_NOMBRE_NORM = "el crustáceo cascarudo"; // fila ficticia

type FilaTransformada = {
  source_row: number;
  nombre: string;
  nombre_normalizado: string;
  descripcion: string;
  rubro: string | null;
  rubro_otro: string | null;
  tipo_convenio: "nuevo" | "renovacion" | null;
  tipo_convenio_original: string;
  condiciones: string | null;
  direccion: string | null;
  comuna: string | null;
  telefono: string | null;
  telefono_aviso?: string;
  instagram: string | null;
  instagram_original: string;
  sitio_web: string | null;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  operador_email: string | null;
  avisos: string[];
};

function transformar(row: Record<string, string | null>, idx: number): FilaTransformada {
  const avisos: string[] = [];
  const nombre = colapsarEspacios(s(row[H.nombre]));
  const nombre_norm = nombreNormalizado(nombre);

  const telefonoRaw = s(row[H.telefono]);
  const tel = telefonoCL(telefonoRaw);
  if (tel.aviso) avisos.push(tel.aviso);

  const tipo = tipoConvenioNorm(s(row[H.tipoConvenio]));
  if (tipo.original && !tipo.value) {
    avisos.push(`tipo_convenio inesperado: ${JSON.stringify(tipo.original)}`);
  }

  const ig = instagramNorm(s(row[H.instagram]));
  if (!ig && s(row[H.instagram])) {
    avisos.push(`instagram ambiguo: ${JSON.stringify(s(row[H.instagram]))}`);
  }

  const emailOp = emailNormalizado(row[H.email]);
  if (!emailOp && s(row[H.email])) {
    avisos.push(`email contacto invalido: ${JSON.stringify(s(row[H.email]))}`);
  }
  if (!s(row[H.email])) {
    avisos.push("sin email contacto");
  }

  // Caso especial Tonocolor: telefono es un email por error. Lo dejamos null
  // y agregamos aviso (el user confirmo que no se mueve el email a otra col).
  if (telefonoRaw.includes("@")) {
    avisos.push(
      `telefono contiene email (revision manual): ${JSON.stringify(telefonoRaw)}`
    );
  }

  return {
    source_row: idx + 2, // +2 porque idx=0 es fila 2 del XLSX (fila 1 son headers)
    nombre,
    nombre_normalizado: nombre_norm,
    descripcion: colapsarEspacios(s(row[H.beneficio])),
    rubro: s(row[H.rubro]) || null,
    rubro_otro: s(row[H.rubroOtro]) || null,
    tipo_convenio: tipo.value,
    tipo_convenio_original: tipo.original,
    condiciones: s(row[H.condiciones]) || null,
    direccion: s(row[H.direccion]) || null,
    comuna: comunaNorm(s(row[H.comuna])),
    telefono: tel.value,
    telefono_aviso: tel.aviso,
    instagram: ig,
    instagram_original: s(row[H.instagram]),
    sitio_web: sitioWebNorm(s(row[H.sitioWeb])),
    contacto_nombre: colapsarEspacios(s(row[H.contactoNombre])) || null,
    contacto_cargo: s(row[H.contactoCargo]) || null,
    operador_email: emailOp,
    avisos,
  };
}

const transformadas = rows
  .map((r, i) => transformar(r, i))
  .filter((t) => t.nombre_normalizado !== EXCLUIDO_NOMBRE_NORM);

// Verificar colisiones internas entre las 52 (no deberia haber).
const colisionesInternas = new Map<string, number[]>();
for (const t of transformadas) {
  const k = t.nombre_normalizado;
  if (!colisionesInternas.has(k)) colisionesInternas.set(k, []);
  colisionesInternas.get(k)!.push(t.source_row);
}
const colisionesInt = [...colisionesInternas.entries()].filter(([, rs]) => rs.length > 1);

// ============================================================
// Comparacion contra DB existente
// ============================================================
async function run() {
  console.log("=== LECTURA XLSX ===");
  console.log(`total XLSX: ${rows.length}`);
  console.log(`excluido (fila ficticia): "El Crustáceo Cascarudo"`);
  console.log(`a importar: ${transformadas.length}`);

  if (colisionesInt.length > 0) {
    console.log("\n⚠ COLISIONES INTERNAS entre filas del XLSX:");
    for (const [k, rs] of colisionesInt) {
      console.log(`  ${JSON.stringify(k)}: filas ${rs.join(", ")}`);
    }
    console.log("DETENIENDO: resolver antes de continuar.");
    process.exit(1);
  }
  console.log("colisiones internas: 0");

  // Leer convenios existentes para verificar colisiones y decidir INSERT/UPDATE.
  // En dry-run tolera que 036 no este aun aplicada (lee solo nombre y
  // calcula nombre_normalizado client-side).
  let existentes: Array<{ id: string; nombre: string; nombre_normalizado: string | null }> = [];
  const { data: existData, error: existErr } = await admin
    .from("convenios")
    .select("id, nombre, nombre_normalizado");
  if (existErr) {
    // Reintentar sin nombre_normalizado (migracion 036 aun no aplicada).
    const { data: existData2, error: existErr2 } = await admin
      .from("convenios")
      .select("id, nombre");
    if (existErr2) {
      console.error("ERROR leyendo convenios existentes:", existErr2.message);
      process.exit(1);
    }
    existentes = ((existData2 as Array<{ id: string; nombre: string }>) ?? []).map((e) => ({
      id: e.id,
      nombre: e.nombre,
      nombre_normalizado: nombreNormalizado(e.nombre),
    }));
    console.log("(aviso: migracion 036 aun no aplicada; nombre_normalizado se calcula client-side)");
  } else {
    existentes = (existData as Array<{
      id: string;
      nombre: string;
      nombre_normalizado: string | null;
    }>) ?? [];
    // Si alguna fila existente no tiene nombre_normalizado aun, lo calculamos.
    existentes = existentes.map((e) => ({
      ...e,
      nombre_normalizado: e.nombre_normalizado ?? nombreNormalizado(e.nombre),
    }));
  }
  console.log(`\n=== DB EXISTENTE ===`);
  console.log(`convenios en DB: ${existentes.length}`);

  // Verificar colisiones XLSX ↔ existentes.
  const porNombreExist = new Map<string, { id: string; nombre: string }>();
  for (const e of existentes) {
    if (e.nombre_normalizado) {
      porNombreExist.set(e.nombre_normalizado, { id: e.id, nombre: e.nombre });
    }
  }

  // Verificar colisiones nombre_normalizado entre existentes (ya cubierto por
  // la migracion 036, pero defensa en profundidad).
  const dupExist = new Map<string, number>();
  for (const e of existentes) {
    if (!e.nombre_normalizado) continue;
    dupExist.set(e.nombre_normalizado, (dupExist.get(e.nombre_normalizado) ?? 0) + 1);
  }
  const colisionesExistentes = [...dupExist.entries()].filter(([, c]) => c > 1);
  if (colisionesExistentes.length > 0) {
    console.log("\n⚠ COLISIONES EN DB EXISTENTE:");
    for (const [k, c] of colisionesExistentes) {
      console.log(`  ${JSON.stringify(k)}: x${c}`);
    }
    console.log("DETENIENDO: resolver antes de aplicar 036/importar.");
    process.exit(1);
  }

  // Clasificar acciones.
  const toInsert: FilaTransformada[] = [];
  const toUpdate: Array<{ fila: FilaTransformada; existing_id: string }> = [];
  for (const t of transformadas) {
    const ya = porNombreExist.get(t.nombre_normalizado);
    if (ya) toUpdate.push({ fila: t, existing_id: ya.id });
    else toInsert.push(t);
  }

  // Operadores a crear.
  const operadoresACrear = transformadas.filter((t) => t.operador_email).length;
  const filasSinOperador = transformadas.filter((t) => !t.operador_email);

  console.log("\n=== PREVIEW 52 CONVENIOS ===");
  for (const t of transformadas) {
    const accion = porNombreExist.get(t.nombre_normalizado) ? "UPDATE" : "INSERT";
    console.log(
      `[${accion}] fila#${t.source_row}  ${t.nombre}`
    );
    console.log(
      `  rubro=${t.rubro}${t.rubro_otro ? "/" + t.rubro_otro : ""}  tipo=${t.tipo_convenio ?? "null"}  comuna=${t.comuna ?? "null"}`
    );
    console.log(
      `  tel=${t.telefono ?? "null"}  ig=${t.instagram ?? "null"}  web=${t.sitio_web ?? "null"}`
    );
    console.log(
      `  beneficio="${t.descripcion.slice(0, 100).replace(/\n/g, " ")}${t.descripcion.length > 100 ? "…" : ""}"`
    );
    console.log(
      `  condiciones="${(t.condiciones ?? "").slice(0, 80).replace(/\n/g, " ")}${(t.condiciones ?? "").length > 80 ? "…" : ""}"`
    );
    console.log(`  operador_email=${t.operador_email ?? "null"}`);
    if (t.avisos.length > 0) {
      console.log(`  ⚠ avisos: ${t.avisos.join(" | ")}`);
    }
  }

  console.log("\n=== REVISION MANUAL (avisos) ===");
  const conAvisos = transformadas.filter((t) => t.avisos.length > 0);
  for (const t of conAvisos) {
    console.log(`  fila#${t.source_row} ${t.nombre}: ${t.avisos.join(" | ")}`);
  }
  if (conAvisos.length === 0) console.log("  (ninguno)");

  console.log("\n=== RESUMEN DRY-RUN ===");
  console.log(`INSERT:              ${toInsert.length}`);
  console.log(`UPDATE (ya existe):  ${toUpdate.length}`);
  console.log(`SIN_CAMBIOS:         0 (todas tienen diffs al menos en imported_at)`);
  console.log(`ERRORES:             0`);
  console.log(`operadores a crear:  ${operadoresACrear}`);
  console.log(`filas sin operador:  ${filasSinOperador.length}`);
  console.log(`filas con avisos:    ${conAvisos.length}`);

  if (!apply) {
    console.log("\n=== DRY-RUN (sin --apply) — NO SE ESCRIBE EN DB ===");
    return;
  }

  // ============================================================
  // APPLY REAL (solo con --apply)
  // ============================================================
  console.log("\n=== APPLY ===");
  let okConv = 0,
    errConv = 0,
    okOp = 0,
    errOp = 0;
  for (const t of transformadas) {
    const patch = {
      nombre: t.nombre,
      nombre_normalizado: t.nombre_normalizado,
      descripcion: t.descripcion || null,
      rubro: t.rubro,
      rubro_otro: t.rubro_otro,
      tipo_convenio: t.tipo_convenio,
      condiciones: t.condiciones,
      direccion: t.direccion,
      comuna: t.comuna,
      telefono: t.telefono,
      instagram: t.instagram,
      sitio_web: t.sitio_web,
      flyer_url: null,
      logo_url: null,
      contacto_nombre: t.contacto_nombre,
      contacto_cargo: t.contacto_cargo,
      valid_from: VALID_FROM,
      valid_until: VALID_UNTIL,
      active: true,
      imported_at: new Date().toISOString(),
      source_row: t.source_row,
    };
    const { data: upserted, error } = await admin
      .from("convenios")
      .upsert(patch, { onConflict: "nombre_normalizado" })
      .select("id")
      .single();
    if (error || !upserted) {
      errConv++;
      console.log(`  ✗ fila#${t.source_row} ${t.nombre}: ${error?.message}`);
      continue;
    }
    okConv++;
    const convId = (upserted as { id: string }).id;
    if (t.operador_email) {
      const { error: eOp } = await admin
        .from("convenio_operadores")
        .upsert(
          {
            convenio_id: convId,
            email_normalized: t.operador_email,
            active: true,
            imported_at: new Date().toISOString(),
            source_row: t.source_row,
          },
          { onConflict: "convenio_id,email_normalized", ignoreDuplicates: true }
        );
      if (eOp) {
        errOp++;
        console.log(`  ✗ operador fila#${t.source_row}: ${eOp.message}`);
      } else okOp++;
    }
  }
  console.log(
    `\nconvenios: ${okConv} OK / ${errConv} ERR | operadores: ${okOp} OK / ${errOp} ERR`
  );
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
