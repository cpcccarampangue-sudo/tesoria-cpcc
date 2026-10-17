// Snapshot numérico del estado antes/después de un backfill. Lee solo
// conteos para dejar un ancla y detectar cambios colaterales en
// membresías, QR, estudiantes, pagos. NO modifica nada.
//
// uso: npx tsx scripts/snapshot-estado.ts

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { clasificarTelefonoCL } from "../lib/normalizar";

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

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SB_URL, SB_SR, {
  auth: { persistSession: false },
});

async function count(tabla: string, filtro?: (q: ReturnType<typeof admin.from>) => ReturnType<typeof admin.from>): Promise<number> {
  let q = admin.from(tabla).select("id", { count: "exact", head: true }) as unknown as ReturnType<typeof admin.from>;
  if (filtro) q = filtro(q);
  const { count: n, error } = (await (q as unknown as { then: unknown })) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return n ?? 0;
}

async function paginar<T>(tabla: string, cols: string): Promise<T[]> {
  const B = 1000;
  const out: T[] = [];
  let d = 0;
  for (;;) {
    const { data, error } = await admin
      .from(tabla)
      .select(cols)
      .range(d, d + B - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    const c = (data as unknown as T[]) ?? [];
    out.push(...c);
    if (c.length < B) break;
    d += B;
  }
  return out;
}

async function main() {
  const etiqueta = process.argv[2] ?? "snapshot";
  const now = new Date().toISOString();
  console.log(`# Snapshot [${etiqueta}]  ${now}`);

  const apod = await paginar<{ id: string; activo: boolean | null; qr_token: string | null }>(
    "apoderados",
    "id, activo, qr_token"
  );
  const contactos = await paginar<{
    id: string;
    telefono: string | null;
    activo: boolean | null;
  }>("contactos", "id, telefono, activo");
  const estud = await paginar<{ id: string; activo: boolean | null }>(
    "estudiantes",
    "id, activo"
  );
  const sols = await paginar<{ id: string; estado: string | null; qr_token: string | null }>(
    "socio_solicitudes",
    "id, estado, qr_token"
  );

  const apodActivos = apod.filter((a) => a.activo !== false).length;
  const qrApod = apod.filter((a) => !!a.qr_token).length;
  const estActivos = estud.filter((e) => e.activo !== false).length;
  const ctxActivos = contactos.filter((c) => c.activo !== false);
  const telValido = ctxActivos.filter(
    (c) => clasificarTelefonoCL(c.telefono) === "valido"
  ).length;
  const telNormalizable = ctxActivos.filter(
    (c) => clasificarTelefonoCL(c.telefono) === "normalizable"
  ).length;
  const telInvalido = ctxActivos.filter(
    (c) => clasificarTelefonoCL(c.telefono) === "invalido"
  ).length;
  const telAusente = ctxActivos.filter(
    (c) => clasificarTelefonoCL(c.telefono) === "ausente"
  ).length;

  const porEstadoSol = new Map<string, number>();
  for (const s of sols) {
    const k = s.estado ?? "<null>";
    porEstadoSol.set(k, (porEstadoSol.get(k) ?? 0) + 1);
  }
  const qrSols = sols.filter((s) => !!s.qr_token).length;

  const payload = {
    label: etiqueta,
    createdAt: now,
    supabase: SB_URL,
    apoderados: { total: apod.length, activos: apodActivos, con_qr_token: qrApod },
    estudiantes: { total: estud.length, activos: estActivos },
    contactos: {
      total: contactos.length,
      activos: ctxActivos.length,
      tel_valido: telValido,
      tel_normalizable: telNormalizable,
      tel_invalido: telInvalido,
      tel_ausente: telAusente,
    },
    socio_solicitudes: {
      total: sols.length,
      por_estado: Object.fromEntries(porEstadoSol),
      con_qr_token: qrSols,
    },
  };

  console.log(JSON.stringify(payload, null, 2));

  const dir = join("scripts", "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = now.replace(/[:.]/g, "-");
  const path = join(dir, `snapshot-${etiqueta}-${ts}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n[snapshot] guardado en ${path}`);
}

main().catch((err) => {
  console.error("snapshot fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
