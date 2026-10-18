// Diagnóstico read-only del estado del QR permanente en PROD. No modifica
// nada. Reporta:
//   - Conteos de qr_token en apoderados y en socio_solicitudes.
//   - Cuántas familias tienen qr_token "canónico" (apoderados.qr_token)
//     y cuántas "legacy" (socio_solicitudes.qr_token).
//   - Cuántas familias son socias activas (socio=true), socias históricas,
//     o nunca fueron socias.
//   - Cuántos qr_token legacy pertenecen a familias cuyo apoderados.qr_token
//     ES distinto (riesgo de inconsistencia).
//   - Cuántas solicitudes "pagada/enviada" NO tienen apoderado_id (QR solo
//     en socio_solicitudes, no en apoderado).

import { execSql } from "./lib/supabase-mgmt";

async function fila(sql: string): Promise<Record<string, unknown>> {
  const r = await execSql(sql);
  return (r.rows[0] as Record<string, unknown>) ?? {};
}

async function main() {
  console.log(`# audit-qr-permanente  ${new Date().toISOString()}`);
  console.log("# NO modifica la base de datos.\n");

  // 1. Totales
  const t1 = await fila(`
    select
      (select count(*)::int from apoderados where activo) as apod_activos,
      (select count(*)::int from apoderados where activo and qr_token is not null) as apod_con_qr,
      (select count(*)::int from apoderados where activo and socio) as apod_socio_true,
      (select count(*)::int from apoderados where activo and socio and qr_token is not null) as apod_socio_con_qr,
      (select count(*)::int from apoderados where activo and socio and qr_token is null) as apod_socio_sin_qr,
      (select count(*)::int from apoderados where activo and not socio) as apod_no_socio,
      (select count(*)::int from apoderados where activo and not socio and qr_token is not null) as apod_no_socio_con_qr
  `);
  console.log("## 1. Totales en apoderados");
  console.log(JSON.stringify(t1, null, 2));

  // 2. socio_solicitudes
  const t2 = await fila(`
    select
      (select count(*)::int from socio_solicitudes) as sol_total,
      (select count(*)::int from socio_solicitudes where qr_token is not null) as sol_con_qr,
      (select count(*)::int from socio_solicitudes where estado in ('pagada','enviada')) as sol_activas,
      (select count(*)::int from socio_solicitudes where estado in ('pagada','enviada') and apoderado_id is null) as sol_activas_sin_apoderado,
      (select count(distinct apoderado_id)::int from socio_solicitudes where estado in ('pagada','enviada') and apoderado_id is not null) as apoderados_con_sol_activa,
      (select count(distinct periodo_anio)::int from socio_solicitudes where estado in ('pagada','enviada')) as periodos_activos
  `);
  console.log("\n## 2. socio_solicitudes");
  console.log(JSON.stringify(t2, null, 2));

  // 3. Breakdown por estado y periodo
  const r3 = await execSql(`
    select periodo_anio, estado, count(*)::int as n
    from socio_solicitudes
    group by periodo_anio, estado
    order by periodo_anio desc, estado
  `);
  console.log("\n## 3. Solicitudes por período y estado");
  for (const row of r3.rows) console.log(`  ${JSON.stringify(row)}`);

  // 4. Inconsistencias canónico vs legacy
  const t4 = await fila(`
    with sol_canonico as (
      select distinct s.apoderado_id, s.qr_token
      from socio_solicitudes s
      join apoderados a on a.id = s.apoderado_id
      where s.qr_token is not null
        and s.apoderado_id is not null
        and a.qr_token is not null
        and s.qr_token <> a.qr_token
    )
    select count(*)::int as apoderados_con_qr_divergente_entre_apoderados_y_solicitud,
           count(distinct apoderado_id)::int as apoderados_distintos
    from sol_canonico
  `);
  console.log("\n## 4. ¿Divergencia entre apoderados.qr_token y socio_solicitudes.qr_token?");
  console.log(JSON.stringify(t4, null, 2));

  // 5. Apoderados sin qr_token que SÍ fueron socios alguna vez (histórico)
  const t5 = await fila(`
    select
      count(*)::int as apod_fue_socio_sin_qr_token
    from apoderados a
    where a.activo
      and a.qr_token is null
      and exists (
        select 1 from socio_solicitudes s
        where s.apoderado_id = a.id
          and s.estado in ('pagada','enviada')
      )
  `);
  console.log("\n## 5. Apoderados que fueron socios en algún momento pero no tienen apoderados.qr_token");
  console.log(JSON.stringify(t5, null, 2));

  // 6. Apoderados activos sin qr_token y sin ninguna solicitud (nunca fueron socios)
  const t6 = await fila(`
    select
      count(*)::int as apod_nunca_socio
    from apoderados a
    where a.activo
      and a.qr_token is null
      and not exists (
        select 1 from socio_solicitudes s
        where s.apoderado_id = a.id
          and s.estado in ('pagada','enviada')
      )
  `);
  console.log("\n## 6. Apoderados que nunca fueron socios (sin qr_token y sin solicitud activa)");
  console.log(JSON.stringify(t6, null, 2));

  // 7. qr_token legacy "huérfanos": en socio_solicitudes pero sin
  //    apoderado_id (nadie canónico puede usarlos)
  const t7 = await fila(`
    select count(*)::int as sol_qr_sin_apoderado
    from socio_solicitudes
    where qr_token is not null
      and apoderado_id is null
  `);
  console.log("\n## 7. QR en socio_solicitudes sin apoderado_id vinculado");
  console.log(JSON.stringify(t7, null, 2));

  // 8. Verificar que el índice único en apoderados.qr_token existe
  const t8 = await execSql(`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.apoderados'::regclass
      and contype = 'u'
  `);
  console.log("\n## 8. Constraints UNIQUE en apoderados");
  for (const row of t8.rows) console.log(`  ${JSON.stringify(row)}`);

  // 9. ¿apoderados.qr_token tiene DEFAULT?
  const t9 = await execSql(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'apoderados'
      and column_name = 'qr_token'
  `);
  console.log("\n## 9. apoderados.qr_token (columna)");
  for (const row of t9.rows) console.log(`  ${JSON.stringify(row)}`);

  console.log("\nFin diagnóstico.");
}

main().catch((err) => {
  console.error("audit fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
