// Prueba realista v2: una sola llamada SQL que BEGIN/.../ROLLBACK.
// Simula la secuencia:
//   1. Una familia pagó su 1a renovación: existe una socio_solicitud
//      cuyo qr_token = apoderados.qr_token (sincronizada por la 038).
//   2. La familia renueva de nuevo (2a renovación): nueva socio_solicitud
//      con DEFAULT qr_token distinto.
//   3. El pago de la 2a renovación llega → la RPC 038 trata de hacer
//      UPDATE socio_solicitudes SET qr_token = canónico.
//   4. UNIQUE constraint sobre socio_solicitudes.qr_token rechaza (la
//      solicitud previa ya tiene ese valor) → la RPC falla.
//
// Si Postgres lanza 23505, el bug está confirmado.

import { execSql } from "./lib/supabase-mgmt";

async function main() {
  console.log(`# test-unique-qr-renovacion-v2  ${new Date().toISOString()}\n`);

  // Elegir apoderado con canónico. Insertamos nosotros la solicitud
  // "previa" sincronizada en la misma tx para simular el estado post-1a
  // renovación.
  const target = await execSql(`
    select a.id as apoderado_id, a.qr_token as canonico
    from apoderados a
    where a.qr_token is not null
    limit 1
  `);
  if (target.rows.length === 0) {
    console.log("No hay apoderado con canónico para probar.");
    return;
  }
  const t = target.rows[0] as { apoderado_id: string; canonico: string };
  console.log(
    `target apoderado=${t.apoderado_id.slice(0, 8)}…  canonico=${t.canonico.slice(0, 8)}…\n`
  );

  // UN SOLO request SQL con todas las operaciones y rollback al final.
  // Si UNIQUE se dispara, la Management API devuelve error y nada queda.
  // Si no se dispara, el ROLLBACK deshace las inserciones de prueba.
  const email1 = `test-prev-${Date.now()}@example.invalid`;
  const email2 = `test-new-${Date.now()}@example.invalid`;
  try {
    await execSql(`
      begin;

      -- 1) Insertar la solicitud "previa" (1a renovación ya pagada y
      -- sincronizada con el canónico; estado 'enviada' para que la
      -- guardia email_enviado_en bloquee cualquier update sobre ella).
      insert into socio_solicitudes (
        apoderado_id, periodo_anio,
        apoderado_nombre, apoderado_email,
        alumno_nombre, curso, monto_cuota,
        estado, qr_token, email_enviado_en
      ) values (
        '${t.apoderado_id}'::uuid, 2098,
        'TEST PREV', '${email1}',
        'TEST', 'TEST', 1,
        'enviada', '${t.canonico}'::uuid, now()
      );

      -- 2) Insertar la solicitud "nueva" (2a renovación recién pagada).
      insert into socio_solicitudes (
        apoderado_id, periodo_anio,
        apoderado_nombre, apoderado_email,
        alumno_nombre, curso, monto_cuota,
        estado
      ) values (
        '${t.apoderado_id}'::uuid, 2099,
        'TEST NEW', '${email2}',
        'TEST', 'TEST', 1,
        'pagada'
      );

      -- 3) Simular la sincronización que ejecuta la RPC 038 ahora.
      update socio_solicitudes
        set qr_token = '${t.canonico}'::uuid
        where apoderado_email = '${email2}'
          and email_enviado_en is null
          and qr_token is distinct from '${t.canonico}'::uuid;

      rollback;
    `);
    console.log(
      "RESULTADO: la sincronización NO lanzó error (bug no reproducible aquí)."
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`RESULTADO: ERROR capturado`);
    console.log(`  ${msg.slice(0, 400)}`);
    if (/23505|unique/i.test(msg)) {
      console.log(
        `\n  >> CONFLICTO UNIQUE CONFIRMADO <<\n` +
          `  La sincronización actual rompería la segunda renovación de una familia.\n`
      );
    }
    // asegurar rollback por si quedó algo colgado
    await execSql(`rollback`).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
