"use client";

import { useState, useTransition } from "react";
import { crearPeriodo } from "../actions";
import { parseCLPInput, formatNumber } from "@/lib/formatters";

export function PeriodoForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    monto: "",
    fecha_vencimiento: "",
  });

  const montoNum = parseCLPInput(form.monto);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (montoNum === null || montoNum < 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    startTransition(async () => {
      try {
        const r = await crearPeriodo({
          nombre: form.nombre.trim(),
          monto: montoNum,
          fecha_vencimiento: form.fecha_vencimiento || null,
        });
        setOk(
          `Período creado. Se generaron ${r.pagosCreados} filas de pago para apoderados activos.`
        );
        setForm({ nombre: "", monto: "", fecha_vencimiento: "" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Nombre *</label>
          <input
            className="input"
            value={form.nombre}
            onChange={(e) =>
              setForm((f) => ({ ...f, nombre: e.target.value }))
            }
            placeholder="Cuota Anual 2026"
          />
        </div>
        <div>
          <label className="label">Monto (CLP) *</label>
          <input
            className="input"
            value={form.monto}
            onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
            inputMode="numeric"
            placeholder="50000"
          />
          {montoNum !== null && (
            <div className="text-xs text-slate-500 mt-1">
              ${formatNumber(montoNum)}
            </div>
          )}
        </div>
        <div>
          <label className="label">Vencimiento (opcional)</label>
          <input
            type="date"
            className="input"
            value={form.fecha_vencimiento}
            onChange={(e) =>
              setForm((f) => ({ ...f, fecha_vencimiento: e.target.value }))
            }
          />
        </div>
      </div>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      {ok && (
        <div className="text-sm bg-green-50 text-green-800 rounded-md p-3">
          {ok}
        </div>
      )}
      <div>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Creando..." : "Crear período"}
        </button>
      </div>
    </form>
  );
}
