"use client";

import { useState, useTransition } from "react";
import { registrarPagoManualSocio } from "../actions";

export type CuentaOp = {
  id: string;
  nombre: string;
  es_principal: boolean;
};

export function PagoManualDialog({
  solicitudId,
  monto,
  cuentas,
}: {
  solicitudId: string;
  monto: number;
  cuentas: CuentaOp[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    cuenta_id: cuentas.find((c) => c.es_principal)?.id ?? cuentas[0]?.id ?? "",
    fecha: new Date().toISOString().slice(0, 10),
    metodo: "efectivo" as "efectivo" | "transferencia" | "cheque" | "otro",
    nota: "",
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await registrarPagoManualSocio({
          solicitud_id: solicitudId,
          cuenta_id: form.cuenta_id,
          fecha: form.fecha,
          metodo: form.metodo,
          nota: form.nota,
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-primary"
        onClick={() => setOpen(true)}
      >
        💵 Registrar pago manual
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border border-slate-300 rounded-md p-3 space-y-3 bg-white"
    >
      <div className="text-sm font-semibold">
        Registrar pago manual · ${monto.toLocaleString("es-CL")}
      </div>
      <p className="text-xs text-slate-500">
        Esto crea un movimiento tipo ingreso en el libro de caja y marca la
        solicitud como pagada. Después puedes enviar el QR al correo del
        apoderado.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Cuenta donde ingresó la plata</label>
          <select
            className="input"
            value={form.cuenta_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, cuenta_id: e.target.value }))
            }
            required
          >
            {cuentas.length === 0 ? (
              <option value="">(no hay cuentas activas)</option>
            ) : (
              cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.es_principal ? " (principal)" : ""}
                </option>
              ))
            )}
          </select>
        </div>
        <div>
          <label className="label">Fecha del pago</label>
          <input
            type="date"
            className="input"
            value={form.fecha}
            onChange={(e) =>
              setForm((f) => ({ ...f, fecha: e.target.value }))
            }
            required
          />
        </div>
        <div>
          <label className="label">Medio de pago</label>
          <select
            className="input"
            value={form.metodo}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                metodo: e.target.value as typeof form.metodo,
              }))
            }
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia bancaria</option>
            <option value="cheque">Cheque</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label className="label">
            Nota{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={form.nota}
            onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
            placeholder="Ej. recibido 05/oct"
          />
        </div>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || !form.cuenta_id}
        >
          {pending ? "Guardando..." : "✓ Confirmar pago"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
