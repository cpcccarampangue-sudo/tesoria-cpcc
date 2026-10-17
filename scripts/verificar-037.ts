// Verificaciones post-migracion 037:
//   1) La definicion de validaciones_log_metodo_check incluye 'email'.
//   2) Insert de prueba con metodo='email' funciona (en transaccion con
//      ROLLBACK al final para no dejar rastro). Si la constraint
//      rechazara 'email', el insert fallaria y lo reportaria.
// NO modifica contactos, apoderados, estudiantes, socio_solicitudes.

import { execSql } from "./lib/supabase-mgmt";

async function main() {
  console.log("# verificar-037\n");

  // 1) Definicion actual del CHECK
  const defRes = await execSql(`
    select pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'validaciones_log' and c.conname = 'validaciones_log_metodo_check'
  `);
  if (defRes.rows.length === 0) {
    console.error("No se encuentra la constraint validaciones_log_metodo_check");
    process.exit(1);
  }
  const def = defRes.rows[0]!.def as string;
  console.log(`CHECK actual: ${def}`);
  if (!/\bemail\b/i.test(def)) {
    console.error("FALLO: la definicion no contiene 'email'");
    process.exit(2);
  }
  console.log("  ✓ incluye 'email'\n");

  // 2) Prueba real: INSERT con metodo='email' dentro de transaccion que
  //    se revierte. Si la constraint rechaza 'email', el INSERT falla y
  //    salimos con error. Si pasa, hacemos ROLLBACK y no queda rastro.
  //    Usamos directiva_actor_hmac fake pero coherente con los CHECKs:
  //    (operador null, directiva no null) + (convenio null).
  const probeRes = await execSql(`
    begin;
    insert into validaciones_log (
      convenio_id, convenio_operador_id, directiva_actor_hmac,
      metodo, resultado, qr_token_hmac, apoderado_id
    ) values (
      null, null, repeat('a', 64),
      'email', 'vigente', null, null
    ) returning id, metodo;
    rollback;
    select count(*)::int as validaciones_total from validaciones_log;
  `);
  console.log(`INSERT prueba (en TX revertida):`);
  console.log(JSON.stringify(probeRes.rows, null, 2));
  // Si llegamos aqui, el insert fue aceptado por el CHECK.
  console.log("  ✓ INSERT con metodo='email' aceptado por la constraint.");
  console.log("  ✓ ROLLBACK aplicado: ningun registro de prueba quedo en la DB.\n");

  console.log("OK: migracion 037 instalada y verificada.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
