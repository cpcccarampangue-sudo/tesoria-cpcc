// Prueba realista: ¿la sincronización qr_token→canónico viola el UNIQUE
// de socio_solicitudes.qr_token cuando una familia renueva por segunda
// vez? Todo dentro de BEGIN/ROLLBACK; no modifica datos permanentes.
//
// Escenario:
//   1. Elegimos un apoderado real con qr_token canónico ya generado.
//   2. Verificamos que tiene AL MENOS una socio_solicitudes vinculada
//      (histórico — ya refleja el canónico o un token distinto por
//      el DEFAULT antiguo).
//   3. Simulamos la 2da renovación: insertamos una socio_solicitudes
//      NUEVA con DEFAULT (uuid distinto al canónico).
//   4. Intentamos la sincronización que hace la RPC 038 ahora:
//        UPDATE socio_solicitudes SET qr_token = <canónico>
//        WHERE id = <nueva> AND email_enviado_en IS NULL
//          AND qr_token IS DISTINCT FROM <canónico>
//   5. Observamos si Postgres lanza 23505 (unique_violation).
//
// Si el error aparece: la lógica actual rompería webhooks SumUp en
// renovaciones reales. Hay que corregir antes de cerrar el módulo.

import { execSql } from "./lib/supabase-mgmt";

async function main() {
  console.log(`# test-unique-qr-renovacion  ${new Date().toISOString()}\n`);

  // T0: ¿el UNIQUE sigue vigente?
  const t0 = await execSql(`
    select conname, contype, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.socio_solicitudes'::regclass
      and contype in ('u','p')
    order by contype desc
  `);
  console.log("## T0: constraints UNIQUE/PK en socio_solicitudes");
  for (const row of t0.rows) console.log(`  ${JSON.stringify(row)}`);

  // T1: elegir un apoderado con canónico Y al menos una solicitud
  //     histórica. (En PROD hay 5 apoderados con canónico y 11
  //     solicitudes.)
  const t1 = await execSql(`
    select a.id as apoderado_id, a.qr_token as canonico,
           (select count(*)::int from socio_solicitudes s
              where s.apoderado_id = a.id) as sol_count
    from apoderados a
    where a.qr_token is not null
      and exists (select 1 from socio_solicitudes s
                    where s.apoderado_id = a.id)
    order by sol_count desc
    limit 1
  `);
  if (t1.rows.length === 0) {
    console.log("## T1: no hay apoderado con canónico + solicitudes para probar");
    return;
  }
  const target = t1.rows[0] as {
    apoderado_id: string;
    canonico: string;
    sol_count: number;
  };
  console.log(
    `\n## T1: target apoderado=${target.apoderado_id.slice(
      0,
      8
    )}…  canonico=${target.canonico.slice(0, 8)}…  solicitudes_actuales=${target.sol_count}`
  );

  // T2: ver si YA hay alguna socio_solicitudes con qr_token == canónico
  //     (si sí, la sincronización se dispararía en el primer intento).
  const t2 = await execSql(`
    select id, estado, periodo_anio, qr_token = '${target.canonico}'::uuid as es_canon
    from socio_solicitudes
    where apoderado_id = '${target.apoderado_id}'::uuid
    order by periodo_anio desc, created_at desc
  `);
  console.log("\n## T2: solicitudes actuales del apoderado target");
  for (const row of t2.rows) console.log(`  ${JSON.stringify(row)}`);

  // T3: SIMULACIÓN DE RENOVACIÓN FUTURA en TX revertida.
  // Insertamos una socio_solicitudes nueva con un UUID random (DEFAULT)
  // y luego intentamos la sincronización que hace la 038. Si cualquier
  // otra solicitud de esa familia ya tiene el canónico, UNIQUE va a
  // violar.
  console.log("\n## T3: simulación 2da renovación en BEGIN/ROLLBACK");
  try {
    const r = await execSql(`
      begin;
      -- Insertar una solicitud sintética con DEFAULT qr_token (no
      -- canónico, por definición del default gen_random_uuid()).
      insert into socio_solicitudes (
        apoderado_id, periodo_anio,
        apoderado_nombre, apoderado_email,
        alumno_nombre, curso, monto_cuota,
        estado
      ) values (
        '${target.apoderado_id}'::uuid, 2099,
        'TEST SYNC', 'test-sync-${Date.now()}@example.invalid',
        'TEST', 'TEST', 1,
        'pagada'
      ) returning id, qr_token;
    `);
    const insertada = r.rows[0] as { id: string; qr_token: string };
    console.log(
      `  INSERT ok  nueva_solicitud=${insertada.id.slice(0, 8)}…  qr_default=${insertada.qr_token.slice(0, 8)}…  canon=${target.canonico.slice(0, 8)}…`
    );

    // Ahora intentamos la sincronización que ejecuta la RPC 038.
    try {
      const upd = await execSql(`
        update socio_solicitudes
          set qr_token = '${target.canonico}'::uuid
          where id = '${insertada.id}'::uuid
            and email_enviado_en is null
            and qr_token is distinct from '${target.canonico}'::uuid
          returning id;
      `);
      console.log(
        `  UPDATE sincroniza  filas=${upd.rows.length}  (sin error de unicidad)`
      );
      // Verificamos si otras solicitudes de la familia también cambiaron.
      await execSql(`rollback`);
      console.log("  ROLLBACK aplicado (nada persiste).");
    } catch (updErr) {
      // Error esperado si existe otra solicitud con el canónico.
      await execSql(`rollback`).catch(() => {});
      const msg =
        updErr instanceof Error ? updErr.message : String(updErr);
      console.log(`  UPDATE FALLÓ: ${msg.slice(0, 300)}`);
      if (/23505|unique/i.test(msg)) {
        console.log(
          `\n  *** CONFLICTO UNIQUE CONFIRMADO ***\n` +
            `  La sincronización actual rompería renovaciones donde el ` +
            `canónico ya está en una solicitud anterior.`
        );
      }
    }
  } catch (insertErr) {
    await execSql(`rollback`).catch(() => {});
    console.log(
      `  INSERT falló (no pude simular): ${insertErr instanceof Error ? insertErr.message : insertErr}`
    );
  }

  // T4: contar cuántos apoderados hoy tendrían este problema en una
  // renovación futura: aquellos con canónico Y al menos una solicitud
  // cuyo qr_token == canónico (porque una futura 2da renovación
  // chocaría con esa).
  const t4 = await execSql(`
    select count(distinct a.id)::int as apoderados_con_solicitud_canonica
    from apoderados a
    join socio_solicitudes s on s.apoderado_id = a.id
    where a.qr_token is not null
      and s.qr_token = a.qr_token
  `);
  console.log(
    `\n## T4: apoderados cuyo canónico YA está en una socio_solicitud (riesgo en próxima renovación): ${JSON.stringify(
      t4.rows[0]
    )}`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
