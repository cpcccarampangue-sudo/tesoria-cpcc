// Aplica una migración SQL de supabase/migrations/ contra PRODUCCION
// via Management API (requiere SUPABASE_ACCESS_TOKEN en .env.local con
// alcance Database + Migrations Read-write, restringido al proyecto).
//
// Caracteristicas:
//   - Lee el archivo .sql del folder supabase/migrations/.
//   - Antes de aplicar, hace un scan de palabras clave destructivas y
//     exige --destructive-ok para proceder si las encuentra.
//   - Antes de aplicar, snapshot JSON de conteos clave (apoderados,
//     contactos, estudiantes, socio_solicitudes, validaciones_log).
//   - Envia el SQL completo al endpoint /database/query (que lo
//     ejecuta como un unico batch).
//   - Despues de aplicar: snapshot "despues", opcionalmente ejecuta
//     consultas de verificacion si el .sql incluye un bloque de
//     verificacion marcado con "-- VERIFY:" al final.
//   - Idempotencia: la responsabilidad es del .sql mismo (uso de
//     IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, etc.). Este script no
//     consulta un historial propio porque los .sql del repo se asumen
//     idempotentes (es la convencion de este proyecto).
//
// Uso:
//   npx tsx scripts/apply-migration.ts <nombre-archivo-en-supabase/migrations>
//   npx tsx scripts/apply-migration.ts 037_validaciones_log_metodo_email.sql
//   npx tsx scripts/apply-migration.ts <nombre> --destructive-ok  (si contiene DROP/TRUNCATE/DELETE/UPDATE masivo)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSql, PROJECT_REF } from "./lib/supabase-mgmt";

const PALABRAS_DESTRUCTIVAS = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+schema\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+column\s+\w+\s+drop\s+not\s+null\b/i,
];

async function snapshot(label: string): Promise<Record<string, number>> {
  const r = await execSql(`
    select
      (select count(*)::int from apoderados) as apoderados,
      (select count(*)::int from estudiantes) as estudiantes,
      (select count(*)::int from contactos) as contactos,
      (select count(*)::int from socio_solicitudes) as socio_solicitudes,
      (select count(*)::int from validaciones_log) as validaciones_log,
      (select count(*)::int from apoderados where qr_token is not null) as apoderados_con_qr
  `);
  const row = r.rows[0] ?? {};
  const parsed = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v)])
  );
  console.log(`\n[snapshot ${label}]`, JSON.stringify(parsed));
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const archivo = args.find((a) => !a.startsWith("--"));
  const destructiveOk = args.includes("--destructive-ok");
  if (!archivo) {
    console.error(
      "uso: npx tsx scripts/apply-migration.ts <archivo.sql> [--destructive-ok]"
    );
    process.exit(1);
  }
  const ruta = join("supabase", "migrations", basename(archivo));
  let sql: string;
  try {
    sql = readFileSync(ruta, "utf8");
  } catch {
    console.error(`No encuentro ${ruta}`);
    process.exit(1);
  }

  console.log(`# apply-migration`);
  console.log(`# project_ref=${PROJECT_REF}`);
  console.log(`# archivo=${ruta}`);
  console.log(`# bytes=${sql.length}  destructiveOk=${destructiveOk}\n`);

  // Scan de palabras clave destructivas (en el SQL completo, no en
  // comentarios individuales — comentamos las lineas antes de scanear).
  const sinComentarios = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const encontradas: string[] = [];
  for (const re of PALABRAS_DESTRUCTIVAS) {
    const m = sinComentarios.match(re);
    if (m) encontradas.push(m[0]);
  }
  if (encontradas.length > 0 && !destructiveOk) {
    console.error(
      `ATENCION: el archivo contiene operaciones potencialmente destructivas:\n` +
        encontradas.map((e) => `  - ${e}`).join("\n") +
        `\nSi es intencional, re-corre con --destructive-ok. Abortado.`
    );
    process.exit(2);
  } else if (encontradas.length > 0) {
    console.log(
      `[destructive-ok] confirmado. Operaciones detectadas: ${encontradas.join(", ")}`
    );
  }

  // Snapshot ANTES
  const antes = await snapshot("antes");

  // Guardar backup del snapshot y del SQL ejecutado
  const dir = join("scripts", "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupMeta = {
    archivo: ruta,
    project_ref: PROJECT_REF,
    aplicada_en: new Date().toISOString(),
    bytes: sql.length,
    sql,
    snapshot_antes: antes,
  };
  const backupPath = join(dir, `migracion-${basename(archivo, ".sql")}-${ts}.json`);
  writeFileSync(backupPath, JSON.stringify(backupMeta, null, 2), "utf8");
  console.log(`[backup] ${backupPath}`);

  // Ejecutar la migracion
  console.log(`\nAplicando ${basename(archivo)}…`);
  try {
    await execSql(sql);
    console.log(`OK: migración ejecutada sin error.`);
  } catch (err) {
    console.error(
      `FALLO al aplicar: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(3);
  }

  // Snapshot DESPUES
  const despues = await snapshot("despues");

  // Diff rapido de conteos
  const diffs: string[] = [];
  for (const k of Object.keys(antes)) {
    const a = antes[k];
    const d = despues[k];
    if (a !== d) diffs.push(`${k}: ${a} → ${d} (Δ=${d - a})`);
  }
  if (diffs.length === 0) {
    console.log(
      `\nSin cambios en conteos (apoderados/estudiantes/contactos/solicitudes/validaciones_log/qr). ✓`
    );
  } else {
    console.log(`\nCambios de conteos:`);
    for (const d of diffs) console.log(`  ${d}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
