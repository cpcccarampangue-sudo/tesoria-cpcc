// Revisa (solo lectura) si hay otras columnas con telefono en el
// esquema public y si existen telefonos aprovechables en
// socio_solicitudes que podrian regularizar un contacto SIN cruzar
// familias ni emails (requisito explicito del usuario).
//
// NO MODIFICA LA DB.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalizarEmail, normalizarTelefonoCL } from "../lib/normalizar";

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
  console.log("# Revisión fuentes de teléfono");
  console.log(`# ${new Date().toISOString()}  supabase=${SB_URL}\n`);

  // 1) Revisamos qué tablas conocidas tienen una columna "telefono" o
  //    similar que podria aplicar a familias/apoderados. Trabajamos con
  //    conocimiento del esquema del repo (no information_schema porque
  //    service_role no la expone por PostgREST). Candidatos: contactos,
  //    socio_solicitudes, convenios. Convenios NO es de familias.
  console.log("## Columnas de teléfono en el esquema");
  console.log("  contactos.telefono                 (familias/apoderados)");
  console.log(
    "  socio_solicitudes.apoderado_telefono (snapshot al incorporarse)"
  );
  console.log(
    "  convenios.telefono                 (comercios en convenio — NO cruzable con socios)"
  );
  console.log(
    "  apoderados: email/telefono fueron movidos a contactos en migración 002.\n"
  );

  // 2) Cruce seguro: busco telefonos en socio_solicitudes que podrian
  //    "rescatar" un contacto cuyo email coincide exactamente con el
  //    de la solicitud (mismo apoderado_id, misma familia, mismo correo).
  //    Esto NO cruza familias. Solo "rellena" un contacto que YA es del
  //    mismo apoderado y del mismo email registrado.
  const contactos = await paginar<{
    id: string;
    apoderado_id: string;
    email: string | null;
    telefono: string | null;
    activo: boolean | null;
  }>("contactos", "id, apoderado_id, email, telefono, activo");
  const solicitudes = await paginar<{
    id: string;
    apoderado_id: string | null;
    apoderado_email: string | null;
    apoderado_telefono: string | null;
    estado: string | null;
    periodo_anio: number | null;
  }>(
    "socio_solicitudes",
    "id, apoderado_id, apoderado_email, apoderado_telefono, estado, periodo_anio"
  );

  // Indexar contactos por (apoderado_id, email_normalizado).
  const contactosPorClave = new Map<string, (typeof contactos)[number]>();
  for (const c of contactos) {
    if (c.activo === false) continue;
    const en = normalizarEmail(c.email);
    if (!en) continue;
    contactosPorClave.set(`${c.apoderado_id}|${en}`, c);
  }

  type Aprovechable = {
    contactoId: string;
    apoderadoId: string;
    telefonoContactoRaw: string | null;
    telefonoSolicitudRaw: string | null;
    telefonoNormalizado: string;
    periodo: number | null;
    solicitudId: string;
  };
  const aprovechables: Aprovechable[] = [];
  const conflictos: Aprovechable[] = [];

  // Agrupamos solicitudes por clave; preferimos la mas reciente (periodo
  // mas alto) por si hay varias para la misma familia.
  const solsOrdenadas = [...solicitudes].sort(
    (a, b) => (b.periodo_anio ?? 0) - (a.periodo_anio ?? 0)
  );
  const vistoClaves = new Set<string>();
  for (const s of solsOrdenadas) {
    if (!s.apoderado_id) continue;
    const en = normalizarEmail(s.apoderado_email);
    if (!en) continue;
    const key = `${s.apoderado_id}|${en}`;
    if (vistoClaves.has(key)) continue; // ya consideramos la mas reciente
    vistoClaves.add(key);

    const contactoMatch = contactosPorClave.get(key);
    if (!contactoMatch) continue;

    const telSolNorm = normalizarTelefonoCL(s.apoderado_telefono);
    if (!telSolNorm) continue;

    const telContactoNorm = normalizarTelefonoCL(contactoMatch.telefono);
    if (telContactoNorm === telSolNorm) continue; // ya coincide

    if (!telContactoNorm) {
      // Contacto sin telefono (ausente/invalido) — aprovechable sin
      // sobrescribir datos existentes.
      aprovechables.push({
        contactoId: contactoMatch.id,
        apoderadoId: contactoMatch.apoderado_id,
        telefonoContactoRaw: contactoMatch.telefono,
        telefonoSolicitudRaw: s.apoderado_telefono,
        telefonoNormalizado: telSolNorm,
        periodo: s.periodo_anio ?? null,
        solicitudId: s.id,
      });
    } else {
      // Ambos normalizan pero a numeros distintos. NO decidir
      // automaticamente — reportar como conflicto.
      conflictos.push({
        contactoId: contactoMatch.id,
        apoderadoId: contactoMatch.apoderado_id,
        telefonoContactoRaw: contactoMatch.telefono,
        telefonoSolicitudRaw: s.apoderado_telefono,
        telefonoNormalizado: telSolNorm,
        periodo: s.periodo_anio ?? null,
        solicitudId: s.id,
      });
    }
  }

  console.log("## Cruce socio_solicitudes → contactos (mismo apoderado + mismo email)\n");
  console.log(
    `  Aprovechables (contacto SIN telefono, solicitud tiene uno válido): ${aprovechables.length}`
  );
  console.log(
    `  Conflictos (ambos tienen telefono y NO coinciden):                   ${conflictos.length}\n`
  );

  if (aprovechables.length > 0) {
    console.log("### Ejemplos de rellenado seguro (datos enmascarados)\n");
    for (const a of aprovechables.slice(0, 8)) {
      const d = a.telefonoNormalizado.replace(/\D/g, "");
      const mask = `${d.slice(0, 4)}…${d.slice(-2)} (último4=${d.slice(-4)})`;
      console.log(
        `  apoderado=${a.apoderadoId.slice(0, 8)}… contactoId=${a.contactoId.slice(
          0,
          8
        )}… nuevo=${mask} periodo=${a.periodo ?? "-"}`
      );
    }
    console.log("");
  }

  if (conflictos.length > 0) {
    console.log(
      "### Conflictos (NO se tocan sin tu confirmación explícita)\n"
    );
    for (const c of conflictos.slice(0, 8)) {
      const d1 = (c.telefonoContactoRaw ?? "").replace(/\D/g, "");
      const d2 = c.telefonoNormalizado.replace(/\D/g, "");
      console.log(
        `  contacto=${c.contactoId.slice(0, 8)}…  contacto_tiene=${d1.slice(0, 4)}…${d1.slice(-2)}  solicitud=${d2.slice(0, 4)}…${d2.slice(-2)}`
      );
    }
    console.log("");
  }

  console.log("Fin revisión.\n");
}

main().catch((err) => {
  console.error("revisar-fuentes-telefonos fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
