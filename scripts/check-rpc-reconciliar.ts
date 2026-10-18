import { execSql } from "./lib/supabase-mgmt";

async function main() {
  const r = await execSql(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reconciliar_pago_socio_core'
  `);
  const def = (r.rows[0] as { def: string }).def;
  console.log(`def_bytes=${def.length}`);
  const yaSinc = /SET qr_token = v_canon_token/.test(def);
  const tieneGenCanon = /SET qr_token = gen_random_uuid\(\)/.test(def);
  console.log(`ya_tiene_sincronizacion_v038=${yaSinc}`);
  console.log(`tiene_generacion_canonico_v035=${tieneGenCanon}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
