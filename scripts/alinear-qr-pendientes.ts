// Opción B: alinear socio_solicitudes.qr_token al canónico de la familia
// SOLO cuando:
//   - La solicitud está en estado pendiente_* (no pagada aún y no enviada).
//   - email_enviado_en IS NULL (no se envió correo con el token anterior).
//   - apoderados.qr_token ya existe (NO se genera uno nuevo aquí; la
//     regla principal es que el canónico se materialice en pago/alta
//     confirmada, no en una solicitud pendiente).
//   - socio_solicitudes.qr_token difiere del canónico.
//
// NO modifica apoderados, estudiantes, contactos, pagos, QR legacy ya
// enviados, ni genera canónicos nuevos.
//
// Uso:
//   npx tsx scripts/alinear-qr-pendientes.ts            (dry-run)
//   npx tsx scripts/alinear-qr-pendientes.ts --apply    (aplica)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSql } from "./lib/supabase-mgmt";

const APPLY = process.argv.includes("--apply");

type Fila = {
  solicitud_id: string;
  apoderado_id: string;
  estado: string;
  qr_token_actual: string;
  qr_token_canonico: string;
  email_enviado_en: string | null;
};

async function main() {
  console.log(`# alinear-qr-pendientes  ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`# ${new Date().toISOString()}\n`);

  // Candidatos: solicitudes pendiente_* cuyo apoderado tiene canónico y
  // cuyo qr_token no coincide con el canónico.
  const r = await execSql(`
    select
      s.id             as solicitud_id,
      s.apoderado_id   as apoderado_id,
      s.estado         as estado,
      s.qr_token       as qr_token_actual,
      a.qr_token       as qr_token_canonico,
      s.email_enviado_en
    from socio_solicitudes s
    join apoderados a on a.id = s.apoderado_id
    where s.estado in ('pendiente_match','pendiente_pago')
      and s.email_enviado_en is null
      and a.qr_token is not null
      and s.qr_token is distinct from a.qr_token
    order by s.created_at
  `);
  const filas = r.rows as unknown as Fila[];
  console.log(`Candidatos: ${filas.length}`);
  for (const f of filas.slice(0, 20)) {
    console.log(
      `  solicitud=${f.solicitud_id.slice(0, 8)}…  apod=${f.apoderado_id.slice(0, 8)}…  estado=${f.estado}  tok_antes=${f.qr_token_actual.slice(0, 8)}…  canon=${f.qr_token_canonico.slice(0, 8)}…`
    );
  }
  if (filas.length > 20) console.log(`  … y ${filas.length - 20} más.`);

  if (!APPLY) {
    console.log(
      `\nFin dry-run. Para aplicar: npx tsx scripts/alinear-qr-pendientes.ts --apply\n`
    );
    return;
  }
  if (filas.length === 0) {
    console.log(`\nNada que aplicar.\n`);
    return;
  }

  // Backup JSON antes de aplicar.
  const dir = join("scripts", "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(dir, `alinear-qr-pendientes-${ts}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        total: filas.length,
        filas,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\n[backup] ${backupPath}`);

  // Aplicar uno por uno con guardias dobles para idempotencia + no tocar
  // solicitudes con correo enviado (defensa en profundidad).
  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const f of filas) {
    try {
      const upd = await execSql(`
        update socio_solicitudes
          set qr_token = '${f.qr_token_canonico}'::uuid
          where id = '${f.solicitud_id}'::uuid
            and email_enviado_en is null
            and estado in ('pendiente_match','pendiente_pago')
            and qr_token is distinct from '${f.qr_token_canonico}'::uuid
          returning id;
      `);
      if (upd.rows.length === 1) {
        console.log(`  OK    ${f.solicitud_id.slice(0, 8)}…`);
        ok++;
      } else {
        console.log(`  SKIP  ${f.solicitud_id.slice(0, 8)}… (ya alineada o cambió de estado)`);
        skip++;
      }
    } catch (err) {
      console.log(
        `  FAIL  ${f.solicitud_id.slice(0, 8)}… ${err instanceof Error ? err.message : err}`
      );
      fail++;
    }
  }
  console.log(`\nResultado: OK=${ok} SKIP=${skip} FAIL=${fail}`);
  console.log(`[backup] ${backupPath}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
