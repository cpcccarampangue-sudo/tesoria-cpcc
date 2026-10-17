// Apply del cruce planilla ↔ Supabase: completa teléfonos faltantes
// usando los correos normalizados del Excel como identificador de
// persona (no de familia).
//
// CONDICIONES OBLIGATORIAS (del usuario):
//   1) Backup JSON de todos los registros modificados antes de escribir.
//   2) Re-verificar inequívocamente antes de escribir fila por fila:
//      - El contacto SIGUE existiendo y activo.
//      - El email del contacto en DB coincide con el email del match.
//      - El teléfono del contacto en DB SIGUE siendo null o cadena vacía
//        (no sobrescribir aunque sea histórico malformado).
//      - El teléfono nuevo cumple +569XXXXXXXX exacto.
//   3) Reporte línea por línea OK / SKIP / ERROR.
//   4) Idempotente: correrlo dos veces no hace cambios la segunda vez.
//
// NO toca socio_solicitudes, apoderados, estudiantes, qr_token.
//
// uso:
//   npx tsx scripts/apply-cruce-excel.ts <xlsx>              (dry-run)
//   npx tsx scripts/apply-cruce-excel.ts <xlsx> --apply       (escribe)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
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

const args = process.argv.slice(2);
const xlsxPath = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
if (!xlsxPath) {
  console.error(
    "uso: npx tsx scripts/apply-cruce-excel.ts <xlsx> [--apply]"
  );
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SB_URL, SB_SR, {
  auth: { persistSession: false },
});

const RE_CL_E164 = /^\+569[0-9]{8}$/;

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

type FilaExcel = {
  familia: string | null;
  persona: string | null;
  emailNorm: string | null;
  telefonoNorm: string | null;
  conflicto: string | null;
};

type ContactoDb = {
  id: string;
  apoderado_id: string;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  activo: boolean | null;
};

type Candidato = {
  contactoId: string;
  apoderadoId: string;
  email: string;          // email_normalizado del match
  telefonoNuevo: string;  // +569XXXXXXXX
  personaExcel: string | null;
  familiaExcel: string | null;
};

function textoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function construirCandidatos(xlsxPath: string): Promise<{
  candidatos: Candidato[];
  descartes: { motivo: string; email: string }[];
}> {
  const wb = XLSX.readFile(xlsxPath);
  const sh = wb.Sheets["Contactos depurados"];
  if (!sh) throw new Error('Hoja "Contactos depurados" faltante.');
  const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sh, {
    defval: null,
    raw: false,
  });
  const filas: FilaExcel[] = rowsRaw.map((r) => ({
    familia: textoOrNull(r["Familia"]),
    persona: textoOrNull(r["Persona"]),
    emailNorm: normalizarEmail(textoOrNull(r["Correo normalizado"])),
    telefonoNorm: normalizarTelefonoCL(textoOrNull(r["Teléfono +56"])),
    conflicto: textoOrNull(r["Otros números (conflicto)"]),
  }));

  // Agrupar por email: una misma persona puede aparecer varias veces
  // (por tener múltiples hijos). Si todas las filas coinciden en el
  // teléfono y ninguna tiene conflicto, agrupamos como un match único.
  type P = {
    emailNorm: string;
    telefonoNorm: string;
    personas: Set<string>;
    familias: Set<string>;
    tieneConflicto: boolean;
  };
  const porEmail = new Map<string, P>();
  for (const f of filas) {
    if (!f.emailNorm) continue;
    if (!f.telefonoNorm || f.conflicto) {
      // Si hay registros SIN tel o CON conflicto para ese email, marcar
      // conflicto para evitar aplicar.
      const prev = porEmail.get(f.emailNorm);
      if (prev) prev.tieneConflicto = true;
      continue;
    }
    const p = porEmail.get(f.emailNorm);
    if (!p) {
      porEmail.set(f.emailNorm, {
        emailNorm: f.emailNorm,
        telefonoNorm: f.telefonoNorm,
        personas: new Set([f.persona ?? ""]),
        familias: new Set([f.familia ?? ""]),
        tieneConflicto: false,
      });
    } else {
      p.personas.add(f.persona ?? "");
      p.familias.add(f.familia ?? "");
      if (p.telefonoNorm !== f.telefonoNorm) p.tieneConflicto = true;
    }
  }

  // Cargar contactos SB
  const contactos = await paginar<ContactoDb>(
    "contactos",
    "id, apoderado_id, nombre, email, telefono, activo"
  );
  const activos = contactos.filter((c) => c.activo !== false);
  const sbPorEmail = new Map<string, ContactoDb[]>();
  for (const c of activos) {
    const en = normalizarEmail(c.email);
    if (!en) continue;
    const arr = sbPorEmail.get(en) ?? [];
    arr.push(c);
    sbPorEmail.set(en, arr);
  }

  const candidatos: Candidato[] = [];
  const descartes: { motivo: string; email: string }[] = [];
  for (const c of activos) {
    const en = normalizarEmail(c.email);
    if (!en) continue;
    // Solo rellenar si el teléfono está vacío (null o cadena vacía
    // tras trim); los históricos malformados NO se tocan.
    const telTrim = (c.telefono ?? "").trim();
    if (telTrim !== "") continue;
    // Correo repetido en SB → no es cruzable 1:1.
    const sbList = sbPorEmail.get(en) ?? [];
    if (sbList.length > 1) {
      descartes.push({ motivo: "email_duplicado_sb", email: en });
      continue;
    }
    const p = porEmail.get(en);
    if (!p) continue;
    if (p.tieneConflicto) {
      descartes.push({ motivo: "conflicto_excel", email: en });
      continue;
    }
    if (!RE_CL_E164.test(p.telefonoNorm)) {
      descartes.push({ motivo: "formato_invalido", email: en });
      continue;
    }
    candidatos.push({
      contactoId: c.id,
      apoderadoId: c.apoderado_id,
      email: en,
      telefonoNuevo: p.telefonoNorm,
      personaExcel: [...p.personas][0] ?? null,
      familiaExcel: [...p.familias][0] ?? null,
    });
  }
  return { candidatos, descartes };
}

async function main() {
  const t0 = Date.now();
  console.log(`# Apply cruce Excel  (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`# ${new Date().toISOString()}  xlsx=${xlsxPath}  supabase=${SB_URL}`);
  console.log(
    APPLY
      ? "# ESCRIBIRA EN LA BASE DE DATOS."
      : "# Dry-run: NO modifica la base de datos.\n"
  );

  const { candidatos, descartes } = await construirCandidatos(xlsxPath!);
  console.log(`\n## Analisis inicial`);
  console.log(`  Candidatos:          ${candidatos.length}`);
  console.log(`  Descartes previos:   ${descartes.length}`);
  for (const d of descartes.slice(0, 20)) {
    const en = d.email.replace(
      /^(.)(.*?)(@.+)$/,
      (_, a, b, c) => `${a}${"*".repeat(Math.min(5, b.length))}${c}`
    );
    console.log(`    - ${d.motivo}: ${en}`);
  }
  if (descartes.length > 20) console.log(`    … y ${descartes.length - 20} más.`);
  console.log("");

  if (!APPLY) {
    console.log("Para aplicar: --apply\n");
    return;
  }

  // Respaldo JSON timestamped (antes de escribir)
  const dir = join("scripts", "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(dir, `apply-cruce-excel-${ts}.json`);
  const backupBody = {
    createdAt: new Date().toISOString(),
    supabase: SB_URL,
    xlsx: xlsxPath,
    totalCandidatos: candidatos.length,
    candidatos,
  };
  writeFileSync(backupPath, JSON.stringify(backupBody, null, 2), "utf8");
  console.log(`[backup] ${backupPath}\n`);

  let ok = 0;
  let skip_tel_ya_llenado = 0;
  let skip_email_mismatch = 0;
  let skip_contacto_desaparecio = 0;
  let skip_formato_invalido = 0;
  let errorUpdate = 0;

  const errores: string[] = [];
  const skipDetalle: string[] = [];

  for (const c of candidatos) {
    // Re-leer la fila
    const { data, error } = await admin
      .from("contactos")
      .select("id, email, telefono, activo")
      .eq("id", c.contactoId)
      .maybeSingle();
    if (error) {
      errorUpdate++;
      errores.push(`[read] ${c.contactoId}: ${error.message}`);
      continue;
    }
    if (!data || (data as { activo: boolean | null }).activo === false) {
      skip_contacto_desaparecio++;
      skipDetalle.push(`SKIP contacto_no_activo ${c.contactoId.slice(0, 8)}…`);
      continue;
    }
    const row = data as {
      email: string | null;
      telefono: string | null;
      activo: boolean | null;
    };
    const telTrim = (row.telefono ?? "").trim();
    if (telTrim !== "") {
      // Idempotencia + no sobrescribir: alguien lo lleno entre el
      // análisis y ahora. Lo omitimos.
      skip_tel_ya_llenado++;
      skipDetalle.push(
        `SKIP tel_ya_lleno ${c.contactoId.slice(0, 8)}…`
      );
      continue;
    }
    const emailActual = normalizarEmail(row.email);
    if (emailActual !== c.email) {
      skip_email_mismatch++;
      skipDetalle.push(
        `SKIP email_cambio ${c.contactoId.slice(0, 8)}… (esperado=${c.email}, actual=${emailActual ?? "null"})`
      );
      continue;
    }
    if (!RE_CL_E164.test(c.telefonoNuevo)) {
      // No deberia pasar porque filtramos antes, pero defensa.
      skip_formato_invalido++;
      continue;
    }
    const { error: updErr } = await admin
      .from("contactos")
      .update({ telefono: c.telefonoNuevo })
      .eq("id", c.contactoId)
      // doble guardia: solo si sigue vacío
      .is("telefono", null);
    if (updErr) {
      errorUpdate++;
      errores.push(`[upd] ${c.contactoId}: ${updErr.message}`);
      continue;
    }
    ok++;
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n## Resultado (${dt}s)`);
  console.log(`  OK:                            ${ok}`);
  console.log(`  SKIP tel_ya_lleno:             ${skip_tel_ya_llenado}`);
  console.log(`  SKIP email_cambio:             ${skip_email_mismatch}`);
  console.log(`  SKIP contacto_no_activo:       ${skip_contacto_desaparecio}`);
  console.log(`  SKIP formato_invalido:         ${skip_formato_invalido}`);
  console.log(`  ERROR escribiendo:             ${errorUpdate}`);
  console.log(`  Total procesado:               ${candidatos.length}`);
  if (errores.length > 0) {
    console.log("\n## Errores:");
    for (const e of errores.slice(0, 20)) console.log(`  ${e}`);
    if (errores.length > 20) console.log(`  … y ${errores.length - 20} más.`);
  }
  if (skipDetalle.length > 0 && skipDetalle.length <= 20) {
    console.log("\n## Skips:");
    for (const s of skipDetalle) console.log(`  ${s}`);
  }
  console.log(`\n[backup] ${backupPath}\n`);
}

main().catch((err) => {
  console.error("apply fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
