"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import {
  fetchLibroCaja,
  fetchBalanceEventos,
  fetchEstadoCuotas,
} from "./actions";
import { formatCLP, formatFecha } from "@/lib/formatters";

export function ReportesClient() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
    const csv = Papa.unparse(rows, { delimiter: ";" });
    // BOM para que Excel es-CL lo abra con UTF-8.
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    triggerDownload(blob, filename);
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function libroCajaCSV() {
    setError(null);
    startTransition(async () => {
      try {
        const rows = await fetchLibroCaja(desde || null, hasta || null);
        const mapped = rows.map((r) => ({
          Fecha: formatFecha(r.fecha),
          Tipo: r.tipo,
          Monto: r.monto,
          "Monto (formateado)": formatCLP(r.monto),
          Cuenta: r.cuenta ?? "",
          Categoría: r.categoria ?? "",
          Evento: r.evento ?? "",
          Descripción: r.descripcion ?? "",
        }));
        downloadCSV(
          `libro-caja-${desde || "inicio"}_${hasta || "hoy"}.csv`,
          mapped
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function balanceEventosCSV() {
    setError(null);
    startTransition(async () => {
      try {
        const rows = await fetchBalanceEventos();
        const mapped = rows.map((r) => ({
          Evento: r.nombre,
          Fecha: r.fecha ? formatFecha(r.fecha) : "",
          Ingresos: r.ingresos,
          Egresos: r.egresos,
          Neto: r.neto,
          "Neto (formateado)": formatCLP(r.neto),
        }));
        downloadCSV(`balance-eventos.csv`, mapped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function estadoCuotasCSV() {
    setError(null);
    startTransition(async () => {
      try {
        const rows = await fetchEstadoCuotas();
        const mapped = rows.map((r) => ({
          Apoderado: r.apoderado,
          Curso: r.curso ?? "",
          Período: r.periodo,
          Monto: r.monto,
          Pagado: r.pagado,
          Saldo: r.saldo,
          Estado: r.estado,
        }));
        downloadCSV(`estado-cuotas.csv`, mapped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  async function libroCajaPDF() {
    setError(null);
    try {
      const rows = await fetchLibroCaja(desde || null, hasta || null);
      // Import dinámico para no pesar el bundle inicial.
      const { pdf, Document, Page, Text, View, StyleSheet } = await import(
        "@react-pdf/renderer"
      );
      const styles = StyleSheet.create({
        page: { padding: 28, fontSize: 9 },
        title: { fontSize: 14, marginBottom: 6, fontWeight: "bold" },
        subtitle: { fontSize: 9, marginBottom: 4, color: "#555" },
        nota: { fontSize: 8, marginBottom: 10, color: "#666", fontStyle: "italic" },
        row: {
          flexDirection: "row",
          borderBottom: 1,
          borderColor: "#eee",
          paddingVertical: 3,
        },
        h: { fontWeight: "bold", backgroundColor: "#f3f4f6" },
        col_fecha: { width: "11%" },
        col_tipo: { width: "9%" },
        col_monto: { width: "13%", textAlign: "right" },
        col_cuenta: { width: "15%" },
        col_cat: { width: "15%" },
        col_evt: { width: "15%" },
        col_desc: { width: "22%" },
        footer: {
          marginTop: 10,
          borderTop: 1,
          borderColor: "#333",
          paddingTop: 6,
          fontSize: 10,
          fontWeight: "bold",
        },
      });
      const totIng = rows
        .filter((r) => r.tipo === "ingreso")
        .reduce((s, r) => s + r.monto, 0);
      const totEgr = rows
        .filter((r) => r.tipo === "egreso")
        .reduce((s, r) => s + r.monto, 0);

      const doc = (
        <Document>
          <Page size="A4" style={styles.page}>
            <Text style={styles.title}>Libro de caja — Tesorería CPCC</Text>
            <Text style={styles.subtitle}>
              {desde || "inicio"} → {hasta || "hoy"}
            </Text>
            <Text style={styles.nota}>
              Excluye transferencias internas entre cuentas y ajustes de saldo
              de apertura. Muestra solo ingresos y egresos operacionales.
            </Text>
            <View style={[styles.row, styles.h]}>
              <Text style={styles.col_fecha}>Fecha</Text>
              <Text style={styles.col_tipo}>Tipo</Text>
              <Text style={styles.col_monto}>Monto</Text>
              <Text style={styles.col_cuenta}>Cuenta</Text>
              <Text style={styles.col_cat}>Categoría</Text>
              <Text style={styles.col_evt}>Evento</Text>
              <Text style={styles.col_desc}>Descripción</Text>
            </View>
            {rows.map((r, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={styles.col_fecha}>{formatFecha(r.fecha)}</Text>
                <Text style={styles.col_tipo}>{r.tipo}</Text>
                <Text style={styles.col_monto}>{formatCLP(r.monto)}</Text>
                <Text style={styles.col_cuenta}>{r.cuenta ?? ""}</Text>
                <Text style={styles.col_cat}>{r.categoria ?? ""}</Text>
                <Text style={styles.col_evt}>{r.evento ?? ""}</Text>
                <Text style={styles.col_desc}>{r.descripcion ?? ""}</Text>
              </View>
            ))}
            <View style={styles.footer}>
              <Text>Ingresos: {formatCLP(totIng)}</Text>
              <Text>Egresos: {formatCLP(totEgr)}</Text>
              <Text>Neto del período: {formatCLP(totIng - totEgr)}</Text>
            </View>
          </Page>
        </Document>
      );
      const blob = await pdf(doc).toBlob();
      triggerDownload(
        blob,
        `libro-caja-${desde || "inicio"}_${hasta || "hoy"}.pdf`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="font-semibold mb-3">Libro de caja</h2>
        <p className="text-xs text-slate-500 mb-3">
          Excluye transferencias internas entre cuentas y ajustes de saldo de
          apertura. Muestra solo ingresos y egresos operacionales.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="label">Desde</label>
            <input
              type="date"
              className="input"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input
              type="date"
              className="input"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={libroCajaCSV}
            disabled={pending}
          >
            Descargar CSV
          </button>
          <button
            className="btn-secondary"
            onClick={libroCajaPDF}
            disabled={pending}
          >
            Descargar PDF
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Balance por evento</h2>
        <button
          className="btn-primary"
          onClick={balanceEventosCSV}
          disabled={pending}
        >
          Descargar CSV
        </button>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Estado de cuotas</h2>
        <p className="text-sm text-slate-600 mb-3">
          Listado apoderado × período con saldo y estado. Útil para revisar
          quién debe.
        </p>
        <button
          className="btn-primary"
          onClick={estadoCuotasCSV}
          disabled={pending}
        >
          Descargar CSV
        </button>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
    </div>
  );
}
