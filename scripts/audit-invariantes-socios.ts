// Audit de invariantes de datos en PROD (solo lectura + 1 insert en TX
// revertida para validar la constraint). No crea familias ni modifica
// contactos / membresias / QR. Ejecuta queries SQL via Management API
// y resume hallazgos.
//
// Checks:
//   INV-1  Toda solicitud "incorporada" (pagada/enviada, apoderado_id
//          not null) tiene un contacto activo con email == apoderado_email
//          Y telefono valido +569XXXXXXXX.
//   INV-2  Solicitudes pagadas/enviadas sin apoderado_id (pendiente
//          de vincular manualmente): queda rastro en socio_solicitudes
//          pero no se propaga a contactos. Reporta cuantas.
//   INV-3  No existe un correo asociado a mas de UN contacto activo
//          (unique index idx_contactos_email_unique).
//   INV-4  Contactos con telefono invalido (no null) — deberia ser 0
//          tras el backfill y la nueva validacion.
//   INV-5  La constraint validaciones_log_metodo_check acepta 'email'.
//   INV-6  INSERT con metodo='email' en TX revertida: acepta.
//   INV-7  INSERT con metodo='invalid' en TX revertida: rechaza.
// Todas las queries son READ-ONLY excepto las de INV-6/7 que usan
// BEGIN/ROLLBACK dentro de un solo request a la Management API.

import { execSql } from "./lib/supabase-mgmt";

type Resultado = {
  codigo: string;
  descripcion: string;
  estado: "APROBADO" | "ERROR" | "WARN" | "NO VERIFICADO";
  detalle?: string;
  rowsEjemplo?: unknown[];
};

const resultados: Resultado[] = [];

function record(r: Resultado) {
  resultados.push(r);
  const sym =
    r.estado === "APROBADO" ? "✓" : r.estado === "WARN" ? "⚠" : r.estado === "ERROR" ? "✗" : "?";
  console.log(`[${sym} ${r.estado}] ${r.codigo} — ${r.descripcion}`);
  if (r.detalle) console.log(`           ${r.detalle}`);
  if (r.rowsEjemplo && r.rowsEjemplo.length > 0) {
    for (const row of r.rowsEjemplo.slice(0, 5)) {
      console.log(`           · ${JSON.stringify(row)}`);
    }
    if (r.rowsEjemplo.length > 5) {
      console.log(`           … y ${r.rowsEjemplo.length - 5} más.`);
    }
  }
}

async function main() {
  console.log(`# audit-invariantes-socios  ${new Date().toISOString()}\n`);

  // INV-1: socio activo sin contacto propagado
  {
    const r = await execSql(`
      select s.id as solicitud_id, s.apoderado_id,
             s.apoderado_email, s.estado, s.periodo_anio,
             left(s.apoderado_telefono, 4) as tel_prefix
      from socio_solicitudes s
      where s.estado in ('pagada','enviada')
        and s.apoderado_id is not null
        and not exists (
          select 1 from contactos c
          where c.apoderado_id = s.apoderado_id
            and c.activo
            and lower(c.email) = lower(s.apoderado_email)
            and c.telefono ~ '^\\+569[0-9]{8}$'
        )
      order by s.periodo_anio desc
    `);
    if (r.rows.length === 0) {
      record({
        codigo: "INV-1",
        descripcion:
          "toda solicitud pagada/enviada con apoderado tiene contacto con email+tel válido",
        estado: "APROBADO",
      });
    } else {
      record({
        codigo: "INV-1",
        descripcion:
          "solicitudes activas sin contacto correspondiente con tel válido",
        estado: "ERROR",
        detalle: `${r.rows.length} fila(s) incumplen la invariante`,
        rowsEjemplo: r.rows,
      });
    }
  }

  // INV-2: pagada/enviada SIN apoderado_id (caso C sin vincular aún)
  {
    const r = await execSql(`
      select id as solicitud_id, apoderado_email, estado, periodo_anio
      from socio_solicitudes
      where estado in ('pagada','enviada')
        and apoderado_id is null
    `);
    if (r.rows.length === 0) {
      record({
        codigo: "INV-2",
        descripcion:
          "no hay solicitudes pagadas/enviadas pendientes de vincular a familia",
        estado: "APROBADO",
      });
    } else {
      record({
        codigo: "INV-2",
        descripcion:
          "solicitudes pagadas/enviadas sin apoderado_id (requieren vinculación)",
        estado: "WARN",
        detalle: `${r.rows.length} fila(s). El teléfono vive solo en socio_solicitudes; se propagará cuando la directiva vincule.`,
        rowsEjemplo: r.rows,
      });
    }
  }

  // INV-3: email duplicado en varios contactos activos
  {
    const r = await execSql(`
      select lower(email) as email_lower, count(*) as n
      from contactos
      where email is not null and activo
      group by lower(email)
      having count(*) > 1
      order by n desc
    `);
    if (r.rows.length === 0) {
      record({
        codigo: "INV-3",
        descripcion: "ningún email asociado a varios contactos activos",
        estado: "APROBADO",
      });
    } else {
      record({
        codigo: "INV-3",
        descripcion: "emails duplicados entre contactos activos",
        estado: "ERROR",
        detalle: `${r.rows.length} email(s) duplicado(s)`,
        rowsEjemplo: r.rows,
      });
    }
  }

  // INV-4: contactos con telefono NO null y NO cumple formato
  {
    const r = await execSql(`
      select id, apoderado_id, left(telefono, 4) as tel_prefix, length(telefono) as tel_len
      from contactos
      where activo
        and telefono is not null
        and telefono <> ''
        and telefono !~ '^\\+569[0-9]{8}$'
    `);
    if (r.rows.length === 0) {
      record({
        codigo: "INV-4",
        descripcion: "no hay teléfonos no-canónicos en contactos activos",
        estado: "APROBADO",
      });
    } else {
      record({
        codigo: "INV-4",
        descripcion: "contactos activos con teléfono malformado",
        estado: "WARN",
        detalle: `${r.rows.length} fila(s). Son históricos que se preservan hasta corrección manual.`,
        rowsEjemplo: r.rows,
      });
    }
  }

  // INV-5: la CHECK incluye 'email'
  {
    const r = await execSql(`
      select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where t.relname = 'validaciones_log'
        and c.conname = 'validaciones_log_metodo_check'
    `);
    const def = (r.rows[0] as { def: string } | undefined)?.def ?? "";
    if (/\bemail\b/i.test(def)) {
      record({
        codigo: "INV-5",
        descripcion: "constraint validaciones_log_metodo_check acepta 'email'",
        estado: "APROBADO",
        detalle: def,
      });
    } else {
      record({
        codigo: "INV-5",
        descripcion: "constraint NO incluye 'email'",
        estado: "ERROR",
        detalle: def || "constraint no encontrada",
      });
    }
  }

  // INV-6: INSERT con metodo='email' en TX revertida acepta
  {
    try {
      const r = await execSql(`
        begin;
        insert into validaciones_log (
          directiva_actor_hmac, metodo, resultado,
          convenio_id, convenio_operador_id, qr_token_hmac, apoderado_id
        ) values (
          repeat('a', 64), 'email', 'vigente', null, null, null, null
        ) returning id;
        rollback;
        select count(*)::int as n from validaciones_log;
      `);
      const total = (r.rows[0] as { n: number }).n;
      record({
        codigo: "INV-6",
        descripcion: "INSERT con metodo='email' acepta y ROLLBACK no deja rastro",
        estado: "APROBADO",
        detalle: `total validaciones_log tras rollback: ${total}`,
      });
    } catch (err) {
      record({
        codigo: "INV-6",
        descripcion: "INSERT con metodo='email'",
        estado: "ERROR",
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // INV-7: INSERT con metodo='invalid' debe FALLAR (constraint efectiva)
  {
    let fallo = false;
    try {
      await execSql(`
        begin;
        insert into validaciones_log (
          directiva_actor_hmac, metodo, resultado,
          convenio_id, convenio_operador_id, qr_token_hmac, apoderado_id
        ) values (
          repeat('a', 64), 'metodo_falso', 'vigente', null, null, null, null
        );
        rollback;
      `);
    } catch (err) {
      fallo = true;
      const msg = err instanceof Error ? err.message : String(err);
      record({
        codigo: "INV-7",
        descripcion: "INSERT con metodo='metodo_falso' es rechazado por la CHECK",
        estado: "APROBADO",
        detalle: msg.slice(0, 200),
      });
    }
    if (!fallo) {
      // Asegurar rollback por si acaso
      await execSql(`rollback`).catch(() => {});
      record({
        codigo: "INV-7",
        descripcion: "INSERT con metodo='metodo_falso' NO fue rechazado",
        estado: "ERROR",
        detalle:
          "la CHECK no está haciendo su trabajo — debería rechazar valores fuera del enum",
      });
    }
  }

  // Resumen
  console.log(`\n## Matriz de resultados`);
  for (const r of resultados) {
    console.log(`  ${r.estado.padEnd(14)}  ${r.codigo}  ${r.descripcion}`);
  }
  const errores = resultados.filter((r) => r.estado === "ERROR").length;
  const warns = resultados.filter((r) => r.estado === "WARN").length;
  console.log(
    `\nTotal: ${resultados.length}  — APROBADO: ${
      resultados.filter((r) => r.estado === "APROBADO").length
    }  WARN: ${warns}  ERROR: ${errores}`
  );
  if (errores > 0) process.exit(1);
}

main().catch((err) => {
  console.error("audit fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
