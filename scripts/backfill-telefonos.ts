// Backfill controlado de teléfonos normalizables.
//
// FASES:
//   1. Teléfonos ya presentes en `contactos.telefono` que normalizan al
//      mismo número final pero cuyo formato no es canónico (ej. "9 5528
//      2630" → "+56955282630"). Se actualiza la MISMA fila.
//   2. Contactos sin teléfono válido cuyo mismo apoderado_id + mismo
//      email tiene un teléfono válido en `socio_solicitudes` (snapshot
//      de incorporación previa). Se COPIA ese teléfono al contacto.
//
// INVARIANTE DURAS (si falla, aborta sin tocar la fila):
//   - El nuevo valor pasa `normalizarTelefonoCL`.
//   - Los últimos 4 dígitos del valor normalizado = últimos 4 dígitos del
//     valor fuente (en fase 1 es el mismo input tras limpiar; en fase 2
//     es el teléfono de la solicitud).
//   - Idempotente: si el contacto ya tiene exactamente el valor nuevo,
//     se omite.
//   - Nunca cruza familias (apoderado_id siempre es el mismo entre
//     origen y destino).
//
// RESPALDO: antes de cualquier UPDATE, se escribe un JSON con todos los
// pares (id, valor_original, valor_nuevo, fase) en scripts/backups/.
// Si el UPDATE falla a mitad, el JSON queda como prueba y permite
// revertir manualmente desde el Dashboard.
//
// USO:
//   npx tsx scripts/backfill-telefonos.ts            (dry-run por default)
//   npx tsx scripts/backfill-telefonos.ts --apply    (ejecuta)
//
// AMBIENTE: usa .env.local (produccion para este proyecto; ver
// project_entorno_unico en memoria).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  normalizarEmail,
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
} catch {}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) {
  console.error("Faltan credenciales en .env.local");
  process.exit(1);
}
const admin = createClient(SB_URL, SB_SR, {
  auth: { persistSession: false },
});

async function paginar<T>(tabla: string, columnas: string): Promise<T[]> {
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

type Op = {
  fase: 1 | 2;
  tabla: "contactos";
  columna: "telefono";
  rowId: string;
  apoderadoId: string;
  valorOriginal: string | null;
  valorNuevo: string;
  // Origen de la informacion (para fase 2 incluye solicitudId).
  fuente: string;
};

function ultimos4(s: string | null): string {
  if (!s) return "";
  return s.replace(/\D/g, "").slice(-4);
}

async function construirOperaciones(): Promise<Op[]> {
  const contactos = await paginar<{
    id: string;
    apoderado_id: string;
    email: string | null;
    telefono: string | null;
    activo: boolean | null;
  }>("contactos", "id, apoderado_id, email, telefono, activo");

  const solicitudes = await paginar<{
    id: string;
    apoderado_id: string | null;
    apoderado_email: string | null;
    apoderado_telefono: string | null;
    periodo_anio: number | null;
  }>(
    "socio_solicitudes",
    "id, apoderado_id, apoderado_email, apoderado_telefono, periodo_anio"
  );

  const ops: Op[] = [];

  // FASE 1: contactos con telefono normalizable "en si mismo".
  for (const c of contactos) {
    if (c.activo === false) continue;
    const norm = normalizarTelefonoCL(c.telefono);
    if (!norm) continue;
    if (c.telefono === norm) continue; // ya canonico
    // Guard de ultimos 4 digitos: debe coincidir con el valor original.
    if (ultimos4(c.telefono) !== ultimos4(norm)) {
      console.warn(
        `[warn] fase1 contacto=${c.id}: últimos 4 cambian (${ultimos4(c.telefono)} → ${ultimos4(norm)}). OMITIDO.`
      );
      continue;
    }
    ops.push({
      fase: 1,
      tabla: "contactos",
      columna: "telefono",
      rowId: c.id,
      apoderadoId: c.apoderado_id,
      valorOriginal: c.telefono,
      valorNuevo: norm,
      fuente: `contactos.telefono original`,
    });
  }

  // FASE 2: contactos sin telefono valido + socio_solicitudes del mismo
  // apoderado + mismo email tiene telefono valido.
  // Indexar contactos por (apoderado_id, email_norm).
  const contactoPorClave = new Map<string, (typeof contactos)[number]>();
  for (const c of contactos) {
    if (c.activo === false) continue;
    const en = normalizarEmail(c.email);
    if (!en) continue;
    contactoPorClave.set(`${c.apoderado_id}|${en}`, c);
  }

  // Preferimos la solicitud mas reciente por clave.
  const solsOrdenadas = [...solicitudes].sort(
    (a, b) => (b.periodo_anio ?? 0) - (a.periodo_anio ?? 0)
  );
  const vistas = new Set<string>();
  for (const s of solsOrdenadas) {
    if (!s.apoderado_id) continue;
    const en = normalizarEmail(s.apoderado_email);
    if (!en) continue;
    const key = `${s.apoderado_id}|${en}`;
    if (vistas.has(key)) continue;
    vistas.add(key);

    const c = contactoPorClave.get(key);
    if (!c) continue;
    const telSolNorm = normalizarTelefonoCL(s.apoderado_telefono);
    if (!telSolNorm) continue;
    const telContactoNorm = normalizarTelefonoCL(c.telefono);
    if (telContactoNorm) continue; // tiene un propio telefono (fase 1 o ya ok)

    // Guard de ultimos 4 digitos sobre la fuente real.
    if (ultimos4(s.apoderado_telefono) !== ultimos4(telSolNorm)) {
      console.warn(
        `[warn] fase2 contacto=${c.id}: últimos 4 cambian. OMITIDO.`
      );
      continue;
    }
    ops.push({
      fase: 2,
      tabla: "contactos",
      columna: "telefono",
      rowId: c.id,
      apoderadoId: c.apoderado_id,
      valorOriginal: c.telefono,
      valorNuevo: telSolNorm,
      fuente: `socio_solicitudes.id=${s.id} periodo=${s.periodo_anio ?? "-"}`,
    });
  }

  return ops;
}

async function main() {
  console.log(`# Backfill teléfonos  (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`# ${new Date().toISOString()}  supabase=${SB_URL}`);
  console.log(
    APPLY
      ? "# ESCRIBIRA EN LA BASE DE DATOS."
      : "# Dry-run: NO modifica la base de datos.\n"
  );

  const ops = await construirOperaciones();
  console.log(`\n## Operaciones propuestas: ${ops.length}`);
  const f1 = ops.filter((o) => o.fase === 1).length;
  const f2 = ops.filter((o) => o.fase === 2).length;
  console.log(`  Fase 1 (normalizar formato):      ${f1}`);
  console.log(`  Fase 2 (rellenar desde solicitud): ${f2}\n`);

  // Mostrar detalle con enmascarado.
  for (const o of ops) {
    const u4 = ultimos4(o.valorNuevo);
    const antes = o.valorOriginal
      ? `"${o.valorOriginal.slice(0, 4)}…${o.valorOriginal.slice(-2)}"`
      : "null";
    console.log(
      `  fase${o.fase}  contacto=${o.rowId.slice(0, 8)}…  apod=${o.apoderadoId.slice(0, 8)}…  antes=${antes}  nuevo=+56…${u4.slice(0, 2)}${u4.slice(2)}  (${o.fuente})`
    );
  }

  if (!APPLY) {
    console.log(
      `\nFin dry-run. Para aplicar: npx tsx scripts/backfill-telefonos.ts --apply\n`
    );
    return;
  }

  if (ops.length === 0) {
    console.log("Nada que aplicar.\n");
    return;
  }

  // Respaldo JSON timestamped
  const dir = join("scripts", "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(dir, `backfill-telefonos-${ts}.json`);
  const backup = {
    createdAt: new Date().toISOString(),
    supabase: SB_URL,
    totalOps: ops.length,
    ops,
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(`\n[backup] escrito: ${backupPath}\n`);

  // Aplicar UPDATEs uno por uno, verificando antes y despues.
  let okCount = 0;
  let failCount = 0;
  for (const o of ops) {
    // Re-leer la fila para evitar sobrescribir si cambio desde el analisis.
    const { data: fila, error: readErr } = await admin
      .from(o.tabla)
      .select("id, telefono")
      .eq("id", o.rowId)
      .maybeSingle();
    if (readErr || !fila) {
      console.log(
        `  SKIP  ${o.rowId.slice(0, 8)}… (read_error=${readErr?.message ?? "no_row"})`
      );
      failCount++;
      continue;
    }
    const actual = (fila as { telefono: string | null }).telefono;
    // Idempotencia: si ya es el valor nuevo, nada que hacer.
    if (actual === o.valorNuevo) {
      console.log(`  SKIP  ${o.rowId.slice(0, 8)}… (ya normalizado)`);
      okCount++;
      continue;
    }
    // Reverificar ultimos 4 digitos ANTES de escribir contra el estado
    // actual leido (no contra la foto que teniamos). Para fase 2, cuando
    // el valor actual es null, el guard aplica solo al nuevo (ya validado).
    if (
      actual !== null &&
      ultimos4(actual) !== ultimos4(o.valorNuevo)
    ) {
      console.log(
        `  ABORT  ${o.rowId.slice(0, 8)}… últimos 4 cambiarían (${ultimos4(actual)} → ${ultimos4(o.valorNuevo)})`
      );
      failCount++;
      continue;
    }

    const { error: updErr } = await admin
      .from(o.tabla)
      .update({ telefono: o.valorNuevo })
      .eq("id", o.rowId);
    if (updErr) {
      console.log(`  FAIL  ${o.rowId.slice(0, 8)}… ${updErr.message}`);
      failCount++;
    } else {
      console.log(`  OK    ${o.rowId.slice(0, 8)}… fase=${o.fase}`);
      okCount++;
    }
  }

  console.log(
    `\n## Resultado: ${okCount} OK, ${failCount} fallos / ${ops.length} total`
  );
  console.log(`[backup] respaldo en ${backupPath}\n`);
}

main().catch((err) => {
  console.error(
    "backfill fallo:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
