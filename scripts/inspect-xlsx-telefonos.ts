// Imprime la estructura del XLSX de telefonos familias 2026 para
// que podamos decidir el mapeo de columnas. NO modifica nada.
// uso: npx tsx scripts/inspect-xlsx-telefonos.ts <ruta.xlsx>

import * as XLSX from "xlsx";

const path = process.argv[2];
if (!path) {
  console.error("uso: npx tsx scripts/inspect-xlsx-telefonos.ts <ruta.xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(path);
console.log(`# Workbook: ${path}`);
console.log(`# Hojas: ${wb.SheetNames.join(", ")}\n`);
for (const sheetName of wb.SheetNames) {
  const sh = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sh, {
    defval: null,
    raw: false,
  });
  console.log(`## Hoja "${sheetName}" — ${rows.length} filas`);
  if (rows.length === 0) {
    console.log("  (vacía)\n");
    continue;
  }
  const headers = Object.keys(rows[0] ?? {});
  console.log(`### Columnas (${headers.length}):`);
  for (const h of headers) console.log(`  - "${h}"`);
  console.log("\n### Primeras 3 filas:");
  for (const r of rows.slice(0, 3)) {
    console.log("  " + JSON.stringify(r));
  }
  console.log("\n");
}
