// Dry-run de normalizacion de telefonos chilenos para socios.
//
// Lee tablas `contactos` y `socio_solicitudes`, clasifica cada telefono
// con lib/normalizar.ts, agrega totales, ejemplos y detecta duplicados
// (dos familias que normalizarian al mismo +56XXXXXXXXX).
//
// NO MODIFICA LA DB. Es puramente lectura/analisis. Resultado se imprime
// como JSON + resumen humano en stdout. Para persistirlo:
//   npx tsx scripts/dry-run-telefonos.ts > dry-run-telefonos.txt
//
// Credenciales via .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
// Usar siempre con el entorno DEV antes de autorizar backfill en PROD.
//
// Uso:
//   npx tsx scripts/dry-run-telefonos.ts
//   npx tsx scripts/dry-run-telefonos.ts --ejemplos=5

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  clasificarTelefonoCL,
  normalizarTelefonoCL,
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
} catch {
  // sigue con env del shell
}

const args = process.argv.slice(2);
const ejArg = args.find((a) => a.startsWith("--ejemplos="));
const EJEMPLOS = ejArg ? parseInt(ejArg.split("=")[1] ?? "6", 10) : 6;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local"
  );
  process.exit(1);
}

const admin = createClient(SB_URL, SB_SR, {
  auth: { persistSession: false },
});

type Clase = "ausente" | "valido" | "normalizable" | "invalido";

type Fila = {
  origen: "contactos" | "socio_solicitudes";
  tablaId: string;
  apoderadoId: string | null;
  familiaNombre: string | null;
  valorOriginal: string | null;
  clase: Clase;
  normalizado: string | null;
};

function mascaraTelefono(t: string | null): string {
  if (!t) return "—";
  // Dejar solo digitos y mostrar los primeros 4 + 4 bullets + ultimos 2.
  // Util para no filtrar numeros completos en logs/informes.
  const d = t.replace(/\D/g, "");
  if (d.length < 6) return "—";
  const head = d.slice(0, Math.min(4, d.length - 4));
  const tail = d.slice(-2);
  return `${head}…${tail} (${t.length} chars)`;
}

function mascaraNombre(n: string | null): string {
  if (!n) return "—";
  const partes = n.trim().split(/\s+/);
  if (partes.length === 0) return "—";
  const p0 = partes[0];
  const inicial = p0.length > 1 ? p0[0] + "." : p0;
  const resto = partes
    .slice(1)
    .map((p) => (p.length > 2 ? p[0] + "***" : p))
    .join(" ");
  return `${inicial} ${resto}`.trim();
}

// Paginador manual: Supabase JS limita a 1000 filas por consulta por
// defecto. Para no asumir que la tabla "cabe", pedimos en bloques de
// 1000 y acumulamos. Soporta tablas con 50k+ filas.
async function fetchTodos<T>(
  tabla: string,
  columnas: string
): Promise<T[]> {
  const BLOQUE = 1000;
  const out: T[] = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await admin
      .from(tabla)
      .select(columnas)
      .range(desde, desde + BLOQUE - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    const chunk = (data as unknown as T[]) ?? [];
    out.push(...chunk);
    if (chunk.length < BLOQUE) break;
    desde += BLOQUE;
  }
  return out;
}

async function main() {
  console.log("# Dry-run normalización teléfonos CPCC");
  console.log(`# ${new Date().toISOString()}`);
  console.log(`# supabase=${SB_URL}`);
  console.log("# NO SE MODIFICA LA BASE DE DATOS.\n");

  // 1) Cargar apoderados (todos, no solo activos) para resolver nombre
  //    de familia incluso en solicitudes antiguas.
  const apoderados = await fetchTodos<{
    id: string;
    nombre: string | null;
    activo: boolean | null;
  }>("apoderados", "id, nombre, activo");
  const nombrePorApod = new Map<string, string>();
  const activoPorApod = new Map<string, boolean>();
  for (const a of apoderados) {
    nombrePorApod.set(a.id, a.nombre ?? "");
    activoPorApod.set(a.id, a.activo ?? false);
  }
  const activos = Array.from(activoPorApod.values()).filter(Boolean).length;
  console.log(
    `apoderados: ${nombrePorApod.size} (activos: ${activos})\n`
  );

  // 2) Cargar contactos (todos; luego filtramos activos para no mezclar
  //    con registros desactivados que ya no afectan al validador).
  const contactosTodos = await fetchTodos<{
    id: string;
    apoderado_id: string;
    telefono: string | null;
    activo: boolean | null;
  }>("contactos", "id, apoderado_id, telefono, activo");
  const contactos = contactosTodos.filter((c) => c.activo !== false);
  console.log(
    `contactos totales=${contactosTodos.length} activos=${contactos.length}\n`
  );

  // 3) Cargar solicitudes de socio (todos los estados y periodos).
  const solicitudes = await fetchTodos<{
    id: string;
    apoderado_id: string | null;
    apoderado_telefono: string | null;
    apoderado_nombre: string | null;
  }>(
    "socio_solicitudes",
    "id, apoderado_id, apoderado_telefono, apoderado_nombre"
  );
  console.log(`socio_solicitudes: ${solicitudes.length}\n`);

  // 4) Clasificar.
  const filas: Fila[] = [];
  for (const c of contactos) {
    filas.push({
      origen: "contactos",
      tablaId: c.id,
      apoderadoId: c.apoderado_id,
      familiaNombre: nombrePorApod.get(c.apoderado_id) ?? null,
      valorOriginal: c.telefono,
      clase: clasificarTelefonoCL(c.telefono),
      normalizado: normalizarTelefonoCL(c.telefono),
    });
  }
  for (const s of solicitudes) {
    filas.push({
      origen: "socio_solicitudes",
      tablaId: s.id,
      apoderadoId: s.apoderado_id,
      familiaNombre:
        (s.apoderado_id && nombrePorApod.get(s.apoderado_id)) ||
        s.apoderado_nombre ||
        null,
      valorOriginal: s.apoderado_telefono,
      clase: clasificarTelefonoCL(s.apoderado_telefono),
      normalizado: normalizarTelefonoCL(s.apoderado_telefono),
    });
  }

  // 5) Totales por tabla y clase.
  const tablas: Array<"contactos" | "socio_solicitudes"> = [
    "contactos",
    "socio_solicitudes",
  ];
  const clases: Clase[] = ["valido", "normalizable", "invalido", "ausente"];
  const totales: Record<string, Record<Clase, number>> = {
    contactos: { valido: 0, normalizable: 0, invalido: 0, ausente: 0 },
    socio_solicitudes: {
      valido: 0,
      normalizable: 0,
      invalido: 0,
      ausente: 0,
    },
  };
  for (const f of filas) {
    totales[f.origen][f.clase]++;
  }

  console.log("## Totales\n");
  for (const t of tablas) {
    console.log(`### ${t}`);
    const subt = Object.values(totales[t]).reduce((a, b) => a + b, 0);
    for (const c of clases) {
      const n = totales[t][c];
      const pct = subt > 0 ? ((n / subt) * 100).toFixed(1) : "0.0";
      console.log(`  ${c.padEnd(14)} ${String(n).padStart(5)}  (${pct}%)`);
    }
    console.log(`  ${"TOTAL".padEnd(14)} ${String(subt).padStart(5)}\n`);
  }

  // 6) Ejemplos por clase (datos enmascarados).
  console.log("## Ejemplos de conversión (datos enmascarados)\n");
  for (const t of tablas) {
    for (const c of clases) {
      const casos = filas
        .filter((f) => f.origen === t && f.clase === c)
        .slice(0, EJEMPLOS);
      if (casos.length === 0) continue;
      console.log(`### ${t} / ${c}`);
      for (const f of casos) {
        const flecha =
          c === "normalizable"
            ? ` → ${f.normalizado}`
            : c === "valido"
              ? " (ya canónico)"
              : "";
        console.log(
          `  familia="${mascaraNombre(f.familiaNombre)}" tel=${mascaraTelefono(
            f.valorOriginal
          )}${flecha}`
        );
      }
      console.log("");
    }
  }

  // 7) Duplicados: mismo telefono normalizado en apoderados DISTINTOS.
  //    Es critico porque un backfill podria consolidar numeros que
  //    pertenecen a familias distintas (ej. dos contactos distintos
  //    comparten un numero mal digitado). NO autorizamos backfill sobre
  //    estos sin revision manual.
  console.log("## Duplicados de teléfono normalizado entre familias distintas\n");
  const porNorm = new Map<
    string,
    Array<{
      apoderadoId: string | null;
      familia: string | null;
      origen: string;
      original: string | null;
    }>
  >();
  for (const f of filas) {
    if (!f.normalizado) continue;
    const arr = porNorm.get(f.normalizado) ?? [];
    arr.push({
      apoderadoId: f.apoderadoId,
      familia: f.familiaNombre,
      origen: f.origen,
      original: f.valorOriginal,
    });
    porNorm.set(f.normalizado, arr);
  }
  let duplicados = 0;
  for (const [tel, arr] of porNorm.entries()) {
    const familias = new Set(
      arr.map((x) => x.apoderadoId).filter((v): v is string => !!v)
    );
    if (familias.size <= 1) continue;
    duplicados++;
    console.log(`  norm=${tel}  familias=${familias.size}  menciones=${arr.length}`);
    for (const x of arr.slice(0, 4)) {
      console.log(
        `    - ${x.origen} ${mascaraNombre(x.familia)}  (orig=${mascaraTelefono(x.original)})`
      );
    }
  }
  if (duplicados === 0) {
    console.log("  (no se detectaron duplicados entre familias)\n");
  } else {
    console.log(
      `\n  TOTAL duplicados-entre-familias: ${duplicados}\n` +
        `  ATENCION: estos NO deben normalizarse automáticamente.\n`
    );
  }

  // 8) Resumen final: cuantos escribiria un backfill
  const escribirContactos = totales.contactos.normalizable;
  const escribirSolicitudes = totales.socio_solicitudes.normalizable;
  console.log("## Resumen de backfill propuesto (si se autoriza)\n");
  console.log(
    `  contactos.telefono       actualizaria: ${escribirContactos} fila(s)`
  );
  console.log(
    `  socio_solicitudes.apoderado_telefono: ${escribirSolicitudes} fila(s)`
  );
  console.log(
    `  Permanecerian intactos (invalido+ausente):` +
      ` ${totales.contactos.invalido + totales.contactos.ausente} + ${
        totales.socio_solicitudes.invalido + totales.socio_solicitudes.ausente
      }`
  );
  console.log("\nFin dry-run.\n");
}

main().catch((err) => {
  console.error("dry-run fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
