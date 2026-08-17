"use client";

import { useState, useTransition } from "react";
import { registrarPago } from "./actions";
import { formatCLP, parseCLPInput, todayISO } from "@/lib/formatters";
import type { CuotaEstado } from "@/lib/types";

type CuentaOption = {
  id: string;
  nombre: string;
  es_principal: boolean;
};

export function PagoDialog({
  pagoId,
  apoderadoNombre,
  periodoNombre,
  montoPeriodo,
  montoActual,
  estadoActual,
  notaActual,
  cuentas,
  cuentaIdActual,
}: {
  pagoId: string;
  apoderadoNombre: string;
  periodoNombre: string;
  montoPeriodo: number;
  montoActual: number;
  estadoActual: CuotaEstado;
  notaActual: string | null;
  cuentas: CuentaOption[];
  cuentaIdActual: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [monto, setMonto] = useState(String(montoActual || montoPeriodo));
  const [estado, setEstado] = useState<CuotaEstado>(estadoActual);
  const [fecha, setFecha] = useState(todayISO());
  const [nota, setNota] = useState(notaActual ?? "");
  const [crearMov, setCrearMov] = useState(true);
  const [cuentaId, setCuentaId] = useState<string>(
    cuentaIdActual ??
      cuentas.find((c) => c.es_principal)?.id ??
      cuentas[0]?.id ??
      ""
  );

  const badgeClass =
    estadoActual === "pagada"
      ? "text-green-700 hover:bg-green-50"
      : estadoActual === "parcial"
      ? "text-amber-700 hover:bg-amber-50"
      : estadoActual === "exenta"
      ? "text-slate-500 hover:bg-slate-100"
      : "text-red-700 hover:bg-red-50";

  const label =
    estadoActual === "pagada"
      ? `✓ ${formatCLP(montoActual)}`
      : estadoActual === "parcial"
      ? `~ ${formatCLP(montoActual)}`
      : estadoActual === "exenta"
      ? "exenta"
      : "pendiente";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const montoNum = parseCLPInput(monto) ?? 0;
    startTransition(async () => {
      try {
        await registrarPago({
          pago_id: pagoId,
          monto_pagado: montoNum,
          estado,
          fecha_pago: montoNum > 0 ? fecha : null,
          nota: nota.trim() || null,
          crear_movimiento: crearMov,
          cuenta_id: crearMov ? cuentaId || null : null,
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`px-2 py-1 rounded text-xs font-medium ${badgeClass}`}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="font-semibold text-slate-900">Registrar pago</h3>
              <p className="text-sm text-slate-600 mt-1">
                <strong>{apoderadoNombre}</strong> — {periodoNombre} (
                {formatCLP(montoPeriodo)})
              </p>
            </div>
            <form onSubmit={submit} className="space-y-3 text-left">
              <div>
                <label className="label">Estado</label>
                <select
                  className="input"
                  value={estado}
                  onChange={(e) => setEstado(e.target.value as CuotaEstado)}
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="parcial">Parcial</option>
                  <option value="pagada">Pagada</option>
                  <option value="exenta">Exenta</option>
                </select>
              </div>
              <div>
                <label className="label">Monto pagado</label>
                <input
                  className="input"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="label">Fecha de pago</label>
                <input
                  type="date"
                  className="input"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Nota (opcional)</label>
                <input
                  className="input"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Ej: transferencia, efectivo..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={crearMov}
                  onChange={(e) => setCrearMov(e.target.checked)}
                />
                Registrar como ingreso en el libro de caja
              </label>
              {crearMov && (
                <div>
                  <label className="label">Cuenta destino</label>
                  <select
                    className="input"
                    value={cuentaId}
                    onChange={(e) => setCuentaId(e.target.value)}
                    required
                  >
                    <option value="">— seleccionar —</option>
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                        {c.es_principal ? " (principal)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    ¿A qué cuenta entró la plata de esta cuota?
                  </p>
                </div>
              )}
              {error && (
                <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Cancelar
                </button>
                <button className="btn-primary" disabled={pending}>
                  {pending ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
