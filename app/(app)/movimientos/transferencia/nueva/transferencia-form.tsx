"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdjuntosManager, type AdjuntoLocal } from "@/components/adjuntos-manager";
import { formatCLP, formatNumber, parseCLPInput, todayISO } from "@/lib/formatters";
import { crearTransferenciaInterna } from "../../actions";

type CuentaOption = {
  id: string;
  nombre: string;
  color: string | null;
  es_principal: boolean;
  activa: boolean;
};

export function TransferenciaForm({
  cuentas,
  initialOrigenId,
  initialDestinoId,
}: {
  cuentas: CuentaOption[];
  initialOrigenId: string;
  initialDestinoId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ultima, setUltima] = useState<{
    origen: string;
    destino: string;
    monto: number;
  } | null>(null);

  const [form, setForm] = useState({
    fecha: todayISO(),
    origen_id: initialOrigenId,
    destino_id: initialDestinoId,
    monto: "",
    descripcion: "",
  });
  const [adjuntosNuevos, setAdjuntosNuevos] = useState<AdjuntoLocal[]>([]);

  const montoNum = parseCLPInput(form.monto);
  const origen = cuentas.find((c) => c.id === form.origen_id);
  const destino = cuentas.find((c) => c.id === form.destino_id);
  const mismaCuenta =
    form.origen_id && form.destino_id && form.origen_id === form.destino_id;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.origen_id || !form.destino_id) {
      setError("Selecciona cuenta origen y cuenta destino.");
      return;
    }
    if (mismaCuenta) {
      setError("La cuenta origen y destino no pueden ser la misma.");
      return;
    }
    if (!montoNum || montoNum <= 0) {
      setError("Ingresa un monto mayor a 0.");
      return;
    }

    const descripcionFinal =
      form.descripcion.trim() ||
      `Transferencia interna: ${origen?.nombre ?? ""} → ${destino?.nombre ?? ""}`;

    startTransition(async () => {
      try {
        await crearTransferenciaInterna({
          fecha: form.fecha,
          cuenta_origen_id: form.origen_id,
          cuenta_destino_id: form.destino_id,
          monto: montoNum,
          descripcion: descripcionFinal,
          adjuntos_nuevos: adjuntosNuevos,
        });
        setUltima({
          origen: origen?.nombre ?? "",
          destino: destino?.nombre ?? "",
          monto: montoNum,
        });
        // Reset form pero conservar fecha y cuentas para agregar otra
        setForm((f) => ({
          fecha: f.fecha,
          origen_id: f.origen_id,
          destino_id: f.destino_id,
          monto: "",
          descripcion: "",
        }));
        setAdjuntosNuevos([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  function swap() {
    setForm((f) => ({ ...f, origen_id: f.destino_id, destino_id: f.origen_id }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {ultima && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 space-y-2">
          <div className="text-sm text-green-900">
            <strong>Transferencia guardada:</strong> {formatCLP(ultima.monto)}{" "}
            desde <strong>{ultima.origen}</strong> hacia{" "}
            <strong>{ultima.destino}</strong>.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setUltima(null)}
            >
              Agregar otra
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => router.push("/movimientos")}
            >
              Volver al listado
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="label">Fecha</label>
        <input
          type="date"
          className="input"
          value={form.fecha}
          onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <div>
          <label className="label">Cuenta origen (sale la plata)</label>
          <select
            className="input"
            value={form.origen_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, origen_id: e.target.value }))
            }
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
        </div>
        <div className="text-center sm:pb-2">
          <button
            type="button"
            className="text-brand-700 hover:underline text-lg"
            title="Intercambiar cuentas"
            onClick={swap}
          >
            ↔
          </button>
        </div>
        <div>
          <label className="label">Cuenta destino (entra la plata)</label>
          <select
            className="input"
            value={form.destino_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, destino_id: e.target.value }))
            }
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
        </div>
      </div>

      {mismaCuenta && (
        <div className="text-sm bg-amber-50 text-amber-800 rounded-md p-2">
          La cuenta origen y destino son la misma.
        </div>
      )}

      <div>
        <label className="label">Monto (CLP)</label>
        <input
          className="input"
          value={form.monto}
          onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
          inputMode="numeric"
          placeholder="200000"
          required
        />
        {montoNum !== null && (
          <div className="text-xs text-slate-500 mt-1">
            ${formatNumber(montoNum)}
          </div>
        )}
      </div>

      <div>
        <label className="label">Descripción (opcional)</label>
        <input
          className="input"
          value={form.descripcion}
          onChange={(e) =>
            setForm((f) => ({ ...f, descripcion: e.target.value }))
          }
          placeholder="Ej: canje giro cajero por transf. desde cta. personal Patricia"
        />
        <p className="text-xs text-slate-500 mt-1">
          Si lo dejas vacío usa: &quot;Transferencia interna: {origen?.nombre ?? "origen"}{" "}
          → {destino?.nombre ?? "destino"}&quot;.
        </p>
      </div>

      <div>
        <label className="label">Adjuntos (opcional)</label>
        <p className="text-xs text-slate-500 mb-2">
          Ideal subir el comprobante del giro cajero + el comprobante de la
          transferencia electrónica. Se asocian a ambos lados de la
          transferencia.
        </p>
        <AdjuntosManager
          mode="local"
          uploadPrefix="transferencia"
          initialLocal={adjuntosNuevos}
          onChange={setAdjuntosNuevos}
        />
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Guardar transferencia"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.back()}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
