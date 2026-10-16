// Lee los valores distintos actualmente presentes en
// validaciones_log.metodo. Confirma que la nueva constraint
// (metodo IN ('qr','manual','apellido','email')) NO deja fuera a
// ningun registro existente — es decir, es puramente aditiva.
//
// NO MODIFICA LA DB.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  const envText = readFileSync(".env.local", "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k]) continue;
    process.env[k] = v.replace(/^["']|["']$/g, "");
  }
} catch {}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) {
  console.error("Faltan credenciales en .env.local");
  process.exit(1);
}
const admin = createClient(SB_URL, SB_SR, {
  auth: { persistSession: false },
});

const PERMITIDOS_NUEVO = new Set(["qr", "manual", "apellido", "email"]);

async function paginar<T>(tabla: string, columnas: string): Promise<T[]> {
  const BLOQUE = 1000;
  const out: T[] = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await admin
      .from(tabla)
      .select(columnas)
      .range(desde, desde + BLOQUE - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    const chunk = (data as unknown as T[]) ?? [];
    out.push(...chunk);
    if (chunk.length < BLOQUE) break;
    desde += BLOQUE;
  }
  return out;
}

async function main() {
  console.log(`# Valores distintos en validaciones_log.metodo`);
  console.log(`# ${new Date().toISOString()}  supabase=${SB_URL}\n`);

  const filas = await paginar<{ metodo: string | null }>(
    "validaciones_log",
    "metodo"
  );
  console.log(`Total filas: ${filas.length}\n`);

  const conteo = new Map<string, number>();
  for (const f of filas) {
    const k = f.metodo ?? "<null>";
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }

  console.log("## Distribucion\n");
  for (const [k, n] of [...conteo.entries()].sort((a, b) => b[1] - a[1])) {
    const dentro = PERMITIDOS_NUEVO.has(k) ? "✓" : "✗";
    console.log(`  ${k.padEnd(14)} ${String(n).padStart(5)}  ${dentro} (${
      PERMITIDOS_NUEVO.has(k) ? "incluido en nueva CHECK" : "NO INCLUIDO — bloquearia filas"
    })`);
  }

  const fueraDeNuevo = [...conteo.keys()].filter(
    (k) => !PERMITIDOS_NUEVO.has(k)
  );
  console.log("");
  if (fueraDeNuevo.length === 0) {
    console.log("OK: la migracion 037 es puramente aditiva.");
    console.log("    Todos los valores existentes siguen siendo validos.");
  } else {
    console.log("ATENCION: hay valores en uso que la nueva CHECK no acepta:");
    for (const k of fueraDeNuevo) {
      console.log(`  - ${k}`);
    }
    console.log("   NO aplicar la migracion sin resolver estos registros.");
  }
}

main().catch((err) => {
  console.error("verificar fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
