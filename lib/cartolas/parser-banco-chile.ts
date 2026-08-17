import * as XLSX from "xlsx";
import type { CartolaParseada, LineaParseada } from "@/lib/types";
import { extraerAnioDeFecha, parseCLPFlexible, parseFechaDDMM } from "./utils";

// Parser de cartola de Banco de Chile (Cuenta Corriente / FAN).
// Estructura:
//   Sheet 'Hoja1' con metadata en las primeras filas y una tabla de movimientos
//   con header en una fila que contiene 'Fecha' y 'Descripción'. Los movimientos
//   van desde la siguiente fila hasta la que dice 'SALDO FINAL'.
export function parseCartolaBancoChile(buffer: ArrayBuffer): CartolaParseada {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets["Hoja1"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    throw new Error("El archivo no tiene hojas legibles.");
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  });

  let year: number | null = null;
  let saldo_inicial: number | null = null;
  let saldo_final: number | null = null;
  let headerRow = -1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let c = 0; c < r.length; c++) {
      const cell = String(r[c] ?? "").trim().toLowerCase();
      if (cell.startsWith("fecha de emisi") || cell === "fecha emisión" || cell === "fecha emision") {
        const val = String(r[c + 1] ?? "").trim();
        const y = extraerAnioDeFecha(val);
        if (y != null) year = y;
      }
      if (cell === "fecha" && String(r[c + 1] ?? "").toLowerCase().includes("descrip")) {
        headerRow = i;
      }
    }
    // Buscar "Saldo Inicial | Saldo Disponible | Linea de Credito" y leer la fila siguiente
    if (
      String(r[0] ?? "").trim().toLowerCase() === "saldo inicial" &&
      String(r[1] ?? "").toLowerCase().includes("saldo disponible")
    ) {
      const next = rows[i + 1];
      if (next) saldo_inicial = parseCLPFlexible(next[0]);
    }
  }

  if (year == null) {
    throw new Error(
      "No pude determinar el año de la cartola (falta 'Fecha de Emisión' en el archivo)."
    );
  }
  if (headerRow === -1) {
    throw new Error(
      "No encontré la tabla de movimientos en la cartola. ¿Es la cartola histórica de Banco Chile?"
    );
  }

  const lineas: LineaParseada[] = [];
  let fecha_inicio: string | null = null;
  let fecha_fin: string | null = null;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const fechaRaw = String(r[0] ?? "").trim();
    const desc = String(r[1] ?? "").trim();
    if (!fechaRaw && !desc) continue;

    const descLow = desc.toLowerCase();
    if (descLow === "saldo inicial") {
      if (saldo_inicial == null) saldo_inicial = parseCLPFlexible(r[5]);
      continue;
    }
    if (descLow === "saldo final") {
      saldo_final = parseCLPFlexible(r[5]);
      break;
    }

    const fecha = parseFechaDDMM(fechaRaw, year);
    if (!fecha) continue;

    const cargos = parseCLPFlexible(r[3]);
    const abonos = parseCLPFlexible(r[4]);
    const saldo = parseCLPFlexible(r[5]);
    const canal = String(r[2] ?? "").trim() || null;

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
      canal,
      saldo_despues: saldo,
      referencia_externa: null,
    });

    if (!fecha_inicio || fecha < fecha_inicio) fecha_inicio = fecha;
    if (!fecha_fin || fecha > fecha_fin) fecha_fin = fecha;
  }

  return { fecha_inicio, fecha_fin, saldo_inicial, saldo_final, lineas };
}
