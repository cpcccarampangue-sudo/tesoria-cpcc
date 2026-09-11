"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCLP, formatFecha, formatFechaHora } from "@/lib/formatters";
import type { Cartola } from "@/lib/types";

type CartolaRow = Cartola & {
  cuenta: { id: string; nombre: string; color: string | null } | null;
};

type AvanceInfo = { total: number; conciliadas: number; pendientes: number };

// Convierte el nombre del archivo en una clave que ordena cronologicamente:
//   - Banco Chile 'cartola_DDMMYYYY.xls' -> 'YYYYMMDD'
//   - Banco Estado 'Excel_Cartola_Historica_Chequera_Electronica N AAAA.xlsx'
//     -> 'AAAA-Npadded' (para ordenar por año y luego numero de cartola)
//   - Fallback: nombre lowercase.
function normalizarArchivoParaOrden(nombre: string | null): string {
  if (!nombre) return "";
  const bch = nombre.match(/cartola_(\d{2})(\d{2})(\d{4})\.xls/i);
  if (bch) return `${bch[3]}${bch[2]}${bch[1]}`;
  const be = nombre.match(/(\d+)\s*(\d{4})\.xlsx?/i);
  if (be) return `${be[2]}-${be[1].padStart(4, "0")}`;
  return nombre.toLowerCase();
}

// Muestra el nombre del archivo en un formato limpio para la tabla:
//   - 'cartola_31072026.xls'                              -> '31/07/2026'
//   - 'Excel_Cartola_...Electronica 6 2026.xlsx'          -> '6-2026'
//   - 'Excel_Cartola_...Electronica (1) 2026.xlsx'        -> '1-2026'
//   - Fallback: nombre original.
function mostrarArchivo(nombre: string | null): string {
  if (!nombre) return "—";
  const bch = nombre.match(/cartola_(\d{2})(\d{2})(\d{4})\.xls/i);
  if (bch) return `${bch[1]}/${bch[2]}/${bch[3]}`;
  // BE: acepta 'N AAAA' o '(N) AAAA' con parentesis opcionales.
  const be = nombre.match(/\(?(\d+)\)?\s+(\d{4})\.xlsx?/i);
  if (be) return `${be[1]}-${be[2]}`;
  return nombre;
}

type SortKey =
  | "cuenta"
  | "periodo"
  | "archivo"
  | "lineas"
  | "reconciliado"
  | "saldo_inicial"
  | "saldo_final"
  | "subida";
type SortDir = "asc" | "desc";

export function CartolasTabla({
  cartolas,
  cuentas,
  avancesPorId,
}: {
  cartolas: CartolaRow[];
  cuentas: { id: string; nombre: string; color: string | null }[];
  avancesPorId: Record<string, AvanceInfo>;
}) {
  const [filtroCuenta, setFiltroCuenta] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("periodo");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "cuenta" || k === "archivo" ? "asc" : "desc");
    }
  }

  const filtradas = useMemo(() => {
    let arr = cartolas.slice();
    if (filtroCuenta) arr = arr.filter((c) => c.cuenta?.id === filtroCuenta);
    arr.sort((a, b) => {
      const mult = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "cuenta":
          return (
            (a.cuenta?.nombre ?? "").localeCompare(b.cuenta?.nombre ?? "") *
            mult
          );
        case "periodo":
          return (
            (a.fecha_fin ?? "").localeCompare(b.fecha_fin ?? "") * mult ||
            (a.fecha_inicio ?? "").localeCompare(b.fecha_inicio ?? "") * mult
          );
        case "archivo":
          return (
            normalizarArchivoParaOrden(a.archivo_nombre).localeCompare(
              normalizarArchivoParaOrden(b.archivo_nombre)
            ) * mult
          );
        case "lineas":
          return (a.filas_total - b.filas_total) * mult;
        case "reconciliado": {
          // Ordenamos por porcentaje de conciliadas; empate por total.
          const av_a = avancesPorId[a.id];
          const av_b = avancesPorId[b.id];
          const pct_a = av_a && av_a.total > 0 ? av_a.conciliadas / av_a.total : 0;
          const pct_b = av_b && av_b.total > 0 ? av_b.conciliadas / av_b.total : 0;
          if (pct_a !== pct_b) return (pct_a - pct_b) * mult;
          return ((av_a?.total ?? 0) - (av_b?.total ?? 0)) * mult;
        }
        case "saldo_inicial":
          return (
            (Number(a.saldo_inicial ?? 0) - Number(b.saldo_inicial ?? 0)) * mult
          );
        case "saldo_final":
          return (
            (Number(a.saldo_final ?? 0) - Number(b.saldo_final ?? 0)) * mult
          );
        case "subida":
          return a.subida_en.localeCompare(b.subida_en) * mult;
      }
    });
    return arr;
  }, [cartolas, filtroCuenta, sortKey, sortDir, avancesPorId]);

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Filtrar por cuenta</label>
          <select
            className="input"
            value={filtroCuenta}
            onChange={(e) => setFiltroCuenta(e.target.value)}
          >
            <option value="">Todas ({cartolas.length})</option>
            {cuentas.map((c) => {
              const n = cartolas.filter((x) => x.cuenta?.id === c.id).length;
              return (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({n})
                </option>
              );
            })}
          </select>
        </div>
        <div className="text-sm text-slate-600 pb-2">
          Mostrando <strong>{filtradas.length}</strong> cartola(s).
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <ThSort
                label="Cuenta"
                sortKey="cuenta"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <ThSort
                label="Período"
                sortKey="periodo"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <ThSort
                label="Archivo"
                sortKey="archivo"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <ThSort
                label="Líneas"
                sortKey="lineas"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <ThSort
                label="Reconciliado"
                sortKey="reconciliado"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <ThSort
                label="Saldo inicial"
                sortKey="saldo_inicial"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <ThSort
                label="Saldo final"
                sortKey="saldo_final"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="right"
              />
              <ThSort
                label="Subida"
                sortKey="subida"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtradas.map((c) => (
              <tr key={c.id}>
                <td className="table-td">
                  {c.cuenta ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: c.cuenta.color ?? "#94a3b8",
                        }}
                        aria-hidden
                      />
                      {c.cuenta.nombre}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="table-td text-sm">
                  {c.fecha_inicio && c.fecha_fin
                    ? c.fecha_inicio === c.fecha_fin
                      ? formatFecha(c.fecha_inicio)
                      : `${formatFecha(c.fecha_inicio)} → ${formatFecha(c.fecha_fin)}`
                    : "—"}
                </td>
                <td
                  className="table-td text-sm text-slate-600"
                  title={c.archivo_nombre ?? ""}
                >
                  {mostrarArchivo(c.archivo_nombre)}
                </td>
                <td className="table-td text-right font-semibold">
                  {c.filas_total}
                </td>
                <td className="table-td">
                  <AvanceCell
                    avance={avancesPorId[c.id]}
                    color={c.cuenta?.color ?? "#94a3b8"}
                  />
                </td>
                <td className="table-td text-right text-sm text-slate-600">
                  {c.saldo_inicial != null ? formatCLP(c.saldo_inicial) : "—"}
                </td>
                <td className="table-td text-right text-sm text-slate-600">
                  {c.saldo_final != null ? formatCLP(c.saldo_final) : "—"}
                </td>
                <td className="table-td text-xs text-slate-500">
                  {formatFechaHora(c.subida_en)}
                </td>
                <td className="table-td text-right">
                  <Link
                    href={`/cartolas/${c.id}`}
                    className="text-brand-700 hover:underline text-sm"
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AvanceCell({
  avance,
  color,
}: {
  avance: AvanceInfo | undefined;
  color: string;
}) {
  if (!avance || avance.total === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const pct = Math.round((avance.conciliadas / avance.total) * 100);
  const completa = avance.pendientes === 0;
  return (
    <div className="min-w-[130px]">
      <div className="text-xs font-medium text-slate-700">
        {avance.conciliadas} / {avance.total}{" "}
        <span
          className={`ml-1 ${completa ? "text-green-700" : "text-slate-500"}`}
        >
          ({pct}%)
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: completa ? "#16a34a" : color,
          }}
        />
      </div>
    </div>
  );
}

function ThSort({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th className={`table-th ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${
          active ? "text-slate-900" : "text-slate-500"
        }`}
      >
        {label}
        {active && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}
