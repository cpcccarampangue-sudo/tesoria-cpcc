import { execSql } from "./lib/supabase-mgmt";

async function main() {
  const r = await execSql(`
    select
      s.id as solicitud,
      s.estado,
      s.email_enviado_en is null as sin_correo,
      a.qr_token is not null as apoderado_con_canonico,
      s.qr_token = a.qr_token as alineada
    from socio_solicitudes s
    join apoderados a on a.id = s.apoderado_id
    where s.estado in ('pendiente_match','pendiente_pago')
  `);
  console.log(`Solicitudes pendiente_* vinculadas: ${r.rows.length}`);
  for (const row of r.rows) console.log(`  ${JSON.stringify(row)}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
