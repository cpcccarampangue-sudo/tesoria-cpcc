import * as XLSX from "xlsx";
import type { CartolaParseada, LineaParseada } from "@/lib/types";
import { extraerAnioDeFecha, parseCLPFlexible, parseFechaDDMM } from "./utils";

// Parser de cartola de Banco Estado (Chequera Electronica).
// Estructura:
//   Hoja 'Resumen' con metadata (Fecha Emision, Saldo Inicial/Final).
//   Hoja 'Movimientos' con header en fila 0:
//     Fecha | Sucursal | N° Cuenta | Alias | N° Cartola | N° Operación |
//     Descripción | Cheques / Cargos | Depósitos / Abonos | Saldo
export function parseCartolaBancoEstado(buffer: ArrayBuffer): CartolaParseada {
  const wb = XLSX.read(buffer, { type: "array" });
  const wsMov = wb.Sheets["Movimientos"];
  const wsResumen = wb.Sheets["Resumen"];
  if (!wsMov) {
    throw new Error(
      "El archivo no tiene hoja 'Movimientos'. ¿Bajaste la cartola desde Banco Estado en formato Excel (Chequera Electrónica)?"
    );
  }

  // Extraer año, saldo inicial y saldo final del Resumen.
  let year: number | null = null;
  let saldo_inicial: number | null = null;
  let saldo_final: number | null = null;

  if (wsResumen) {
    const rowsR = XLSX.utils.sheet_to_json<string[]>(wsResumen, {
      header: 1,
      defval: "",
      raw: false,
    });
    for (const r of rowsR) {
      const label = String(r[0] ?? "").trim().toLowerCase();
      const val = String(r[4] ?? "").trim();
      if (!label) continue;
      if (label.startsWith("fecha emisi")) {
        year = extraerAnioDeFecha(val);
      }
      if (label === "saldo inicial") saldo_inicial = parseCLPFlexible(val);
      if (label === "saldo final") saldo_final = parseCLPFlexible(val);
    }
  }
  if (year == null) {
    throw new Error(
      "No pude determinar el año de la cartola (falta 'Fecha Emisión' en la hoja Resumen)."
    );
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(wsMov, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (rows.length < 2) {
    throw new Error("La hoja 'Movimientos' está vacía.");
  }

  const lineas: LineaParseada[] = [];
  let fecha_inicio: string | null = null;
  let fecha_fin: string | null = null;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fechaRaw = String(r[0] ?? "").trim();
    if (!fechaRaw) continue;
    const fecha = parseFechaDDMM(fechaRaw, year);
    if (!fecha) continue;
    const cargos = parseCLPFlexible(r[7]);
    const abonos = parseCLPFlexible(r[8]);
    const saldo = parseCLPFlexible(r[9]);
    const desc = String(r[6] ?? "").trim();
    const noOp = String(r[5] ?? "").trim();

    let tipo: "ingreso" | "egreso";
    let monto: number;
    if (cargos && cargos > 0) {
      tipo = "egreso";
      monto = cargos;
    } else if (abonos && abonos > 0) {
      tipo = "ingreso";
      monto = abonos;
    } else {
      continue;
    }

    lineas.push({
      fila_num: i + 1,
      fecha,
      descripcion: desc || "(sin descripción)",
      monto,
      tipo,
      canal: null,
      saldo_despues: saldo,
      referencia_externa: noOp || null,
    });

    if (!fecha_inicio || fecha < fecha_inicio) fecha_inicio = fecha;
    if (!fecha_fin || fecha > fecha_fin) fecha_fin = fecha;
  }

  return { fecha_inicio, fecha_fin, saldo_inicial, saldo_final, lineas };
}
