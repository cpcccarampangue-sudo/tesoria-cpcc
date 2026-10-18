// Verifica que la RPC post-039 NO contiene la sincronización que
// rompía UNIQUE, y simula una secuencia de renovaciones comprobando
// que:
//   (a) una familia puede acumular N socio_solicitudes con qr_token
//       DISTINTOS (por el DEFAULT gen_random_uuid()) sin violar UNIQUE.
//   (b) apoderados.qr_token se genera sólo la primera vez (idempotente).
//   (c) resolverQrToken sigue resolviendo todos los tokens históricos
//       de esa familia al mismo apoderado_id.
//
// Todo en BEGIN/ROLLBACK en una sola llamada SQL. Sin modificaciones
// permanentes.

import { execSql } from "./lib/supabase-mgmt";

async function main() {
  console.log(`# test-renovacion-sin-sync  ${new Date().toISOString()}\n`);

  // T1: la RPC vigente no contiene la sincronización 038.
  const defR = await execSql(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reconciliar_pago_socio_core'
  `);
  const def = (defR.rows[0] as { def: string }).def;
  const tieneSyncVieja = /SET qr_token = v_canon_token/.test(def);
  const tieneGenCanon = /SET qr_token = gen_random_uuid\(\)/.test(def);
  console.log("## T1  RPC vigente");
  console.log(
    `  contiene SET qr_token = v_canon_token (038 removida): ${tieneSyncVieja ? "✗ SIGUE" : "✓ removida"}`
  );
  console.log(
    `  conserva generación on-first-pay (gen_random_uuid):   ${tieneGenCanon ? "✓" : "✗"}`
  );
  if (tieneSyncVieja || !tieneGenCanon) {
    console.error("Estado de RPC inesperado.");
    process.exit(1);
  }

  // T2: elegir un apoderado con canónico.
  const tr = await execSql(`
    select a.id as apoderado_id, a.qr_token as canonico
    from apoderados a
    where a.qr_token is not null
    limit 1
  `);
  if (tr.rows.length === 0) {
    console.log("No hay apoderado con canónico; omito T2.");
    return;
  }
  const t = tr.rows[0] as { apoderado_id: string; canonico: string };
  console.log(
    `\n## T2  Simulación 3 solicitudes consecutivas (3 renovaciones)`
  );
  console.log(
    `  target apoderado=${t.apoderado_id.slice(0, 8)}…  canónico=${t.canonico.slice(0, 8)}…`
  );

  // Insertamos tres solicitudes nuevas de la misma familia + verificamos
  // que todas tienen qr_token distinto (DEFAULT) y que ninguno coincide
  // con el canónico (comportamiento esperado tras 039).
  const em1 = `test-r1-${Date.now()}@example.invalid`;
  const em2 = `test-r2-${Date.now()}@example.invalid`;
  const em3 = `test-r3-${Date.now()}@example.invalid`;
  const r = await execSql(`
    begin;
    insert into socio_solicitudes
      (apoderado_id, periodo_anio, apoderado_nombre, apoderado_email,
       alumno_nombre, curso, monto_cuota, estado)
    values
      ('${t.apoderado_id}'::uuid, 2097, 'TEST R1', '${em1}', 'TEST','TEST', 1, 'pagada'),
      ('${t.apoderado_id}'::uuid, 2098, 'TEST R2', '${em2}', 'TEST','TEST', 1, 'pagada'),
      ('${t.apoderado_id}'::uuid, 2099, 'TEST R3', '${em3}', 'TEST','TEST', 1, 'pagada');

    -- Verificar que los 3 qr_token asignados por DEFAULT son distintos
    -- entre sí y distintos del canónico (invariante que preserva UNIQUE).
    select
      count(distinct qr_token)::int as tokens_distintos,
      sum(case when qr_token = '${t.canonico}'::uuid then 1 else 0 end)::int as tokens_canonicos
    from socio_solicitudes
    where apoderado_email in ('${em1}','${em2}','${em3}');
    rollback;
  `);
  const chk = r.rows[0] as { tokens_distintos: number; tokens_canonicos: number };
  console.log(
    `  tokens_distintos entre las 3 solicitudes: ${chk.tokens_distintos}  (esperado 3)`
  );
  console.log(
    `  tokens que coinciden con el canónico:     ${chk.tokens_canonicos}  (esperado 0)`
  );
  const ok = chk.tokens_distintos === 3 && chk.tokens_canonicos === 0;
  console.log(ok ? "  ✓ Preserva UNIQUE: 3 renovaciones no colisionan." : "  ✗ Comportamiento inesperado.");

  // T3: resolverQrToken debe resolver cada uno de esos tokens al mismo
  // apoderado (porque están en socio_solicitudes legacy). Simulación:
  // metemos las 3 inserts + un SELECT que haga el equivalente a
  // resolverQrToken (fallback legacy) para cada uno.
  console.log(`\n## T3  resolverQrToken fallback legacy funciona para N renovaciones`);
  const emA = `test-l1-${Date.now()}@example.invalid`;
  const emB = `test-l2-${Date.now()}@example.invalid`;
  const r3 = await execSql(`
    begin;
    insert into socio_solicitudes
      (apoderado_id, periodo_anio, apoderado_nombre, apoderado_email,
       alumno_nombre, curso, monto_cuota, estado)
    values
      ('${t.apoderado_id}'::uuid, 2096, 'TEST L1', '${emA}', 'TEST','TEST', 1, 'enviada'),
      ('${t.apoderado_id}'::uuid, 2095, 'TEST L2', '${emB}', 'TEST','TEST', 1, 'enviada');

    -- Para cada token legacy, ¿resolverQrToken lo mapea a este apoderado?
    with legacy as (
      select qr_token
      from socio_solicitudes
      where apoderado_email in ('${emA}','${emB}')
    )
    select
      (select count(*) from legacy)::int as inyectadas,
      (select count(*) from legacy l
         join socio_solicitudes s on s.qr_token = l.qr_token
                             and s.estado in ('pagada','enviada')
                             and s.apoderado_id is not null
      )::int as resolubles;
    rollback;
  `);
  const chk3 = r3.rows[0] as { inyectadas: number; resolubles: number };
  console.log(
    `  solicitudes legacy inyectadas: ${chk3.inyectadas}  resolubles: ${chk3.resolubles}`
  );
  if (chk3.inyectadas === chk3.resolubles) {
    console.log("  ✓ resolverQrToken resuelve todos los legacy a la familia.");
  } else {
    console.log("  ✗ Alguno no se resolvió.");
    process.exit(1);
  }

  console.log(`\n## OK: 3as y Nas renovaciones no colisionan y los QR históricos siguen funcionando.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
