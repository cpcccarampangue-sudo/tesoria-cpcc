// Verifica el acceso de SUPABASE_ACCESS_TOKEN con una consulta de SOLO
// LECTURA (nada se modifica). Si el token no esta, falla con mensaje
// claro sin exponer datos.

import { execSql, tokenHuella, PROJECT_REF } from "./lib/supabase-mgmt";

async function main() {
  const huella = tokenHuella();
  console.log(`# verificar-token-supabase`);
  console.log(`# project_ref=${PROJECT_REF}`);
  console.log(`# token: longitud=${huella.length} sha256(10)=${huella.sha10}\n`);

  const r = await execSql(
    `select
       current_user as usuario,
       current_setting('server_version') as pg_version,
       (select count(*)::int from validaciones_log) as validaciones_log_count,
       (select count(*)::int from contactos) as contactos_count,
       (select count(*)::int from apoderados) as apoderados_count`
  );
  console.log("Resultado consulta de solo lectura:");
  for (const row of r.rows) {
    console.log(JSON.stringify(row, null, 2));
  }
  console.log("\nOK: el token funciona para consultas sobre la DB del proyecto.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
