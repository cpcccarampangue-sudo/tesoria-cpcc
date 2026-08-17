"use client";

import { useState, useTransition } from "react";
import { formatCLP } from "@/lib/formatters";
import type { BalancePorCuenta, Cuenta, CuentaTipo } from "@/lib/types";
import {
  actualizarCuenta,
  eliminarCuenta,
  marcarComoPrincipal,
  toggleCuentaActiva,
} from "./actions";

const TIPO_LABEL: Record<CuentaTipo, string> = {
  banco: "Bancaria",
  efectivo: "Efectivo",
  otro: "Otro",
};

export function CuentaRow({
  cuenta,
  balance,
}: {
  cuenta: Cuenta;
  balance: BalancePorCuenta | null;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState(cuenta.nombre);
  const [tipo, setTipo] = useState<CuentaTipo>(cuenta.tipo);
  const [banco, setBanco] = useState(cuenta.banco ?? "");
  const [titular, setTitular] = useState(cuenta.titular ?? "");
  const [numero, setNumero] = useState(cuenta.numero_cuenta ?? "");
  const [color, setColor] = useState(cuenta.color ?? "#64748b");

  function saveEdit() {
    setError(null);
    if (!nombre.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    startTransition(async () => {
      try {
        await actualizarCuenta(cuenta.id, {
          nombre: nombre.trim(),
          tipo,
          banco: tipo === "banco" ? banco || null : null,
          titular: titular || null,
          numero_cuenta: numero || null,
          color,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  function doDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await eliminarCuenta(cuenta.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
        setConfirm(false);
      }
    });
  }

  const saldo = Number(balance?.saldo ?? 0);
  const count = balance?.movimientos_count ?? 0;

  if (editing) {
    return (
      <tr>
        <td className="table-td" colSpan={6}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Nombre</label>
                <input
                  className="input"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Tipo</label>
                <select
                  className="input"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as CuentaTipo)}
                >
                  <option value="banco">Cuenta bancaria</option>
                  <option value="efectivo">Caja / efectivo</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="label">Color</label>
                <input
                  type="color"
                  className="input h-[42px] p-1"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
              {tipo === "banco" && (
                <div>
                  <label className="label">Banco</label>
                  <select
                    className="input"
                    value={banco}
                    onChange={(e) => setBanco(e.target.value)}
                  >
                    <option value="">— seleccionar —</option>
                    <option value="banco_estado">Banco Estado</option>
                    <option value="banco_chile">Banco de Chile</option>
                    <option value="bci">BCI</option>
                    <option value="santander">Santander</option>
                    <option value="scotiabank">Scotiabank</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              )}
              <div>
                <label className="label">Titular</label>
                <input
                  className="input"
                  value={titular}
                  onChange={(e) => setTitular(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Número de cuenta</label>
                <input
                  className="input"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                />
              </div>
            </div>
            {error && (
              <div className="text-sm bg-red-50 text-red-800 rounded-md p-2">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="btn-primary"
                onClick={saveEdit}
                disabled={pending}
              >
                {pending ? "Guardando..." : "Guardar cambios"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancelar
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={cuenta.activa ? "" : "opacity-50"}>
      <td className="table-td">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: cuenta.color ?? "#94a3b8" }}
            aria-hidden
          />
          <span className="font-medium">{cuenta.nombre}</span>
          {cuenta.es_principal && (
            <span className="badge-blue text-xs">principal</span>
          )}
          {!cuenta.activa && <span className="badge-slate text-xs">inactiva</span>}
        </div>
      </td>
      <td className="table-td text-sm text-slate-600">{TIPO_LABEL[cuenta.tipo]}</td>
      <td className="table-td text-sm text-slate-600">{cuenta.titular ?? "—"}</td>
      <td className="table-td text-right text-sm text-slate-600">{count}</td>
      <td
        className={`table-td text-right font-semibold ${
          saldo >= 0 ? "text-slate-900" : "text-red-700"
        }`}
      >
        {formatCLP(saldo)}
      </td>
      <td className="table-td text-right">
        <div className="flex justify-end flex-wrap gap-3 text-xs">
          {!cuenta.es_principal && cuenta.activa && (
            <button
              className="text-brand-700 hover:underline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await marcarComoPrincipal(cuenta.id);
                })
              }
            >
              Marcar principal
            </button>
          )}
          <button
            className="text-slate-600 hover:underline"
            onClick={() => setEditing(true)}
          >
            Editar
          </button>
          <button
            className="text-slate-600 hover:underline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await toggleCuentaActiva(cuenta.id, !cuenta.activa);
              })
            }
          >
            {cuenta.activa ? "Desactivar" : "Activar"}
          </button>
          {confirm ? (
            <>
              <button
                className="text-red-700 font-semibold"
                disabled={pending}
                onClick={doDelete}
              >
                Confirmar
              </button>
              <button
                className="text-slate-500"
                onClick={() => {
                  setConfirm(false);
                  setError(null);
                }}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              className="text-red-600 hover:underline"
              onClick={() => setConfirm(true)}
            >
              Eliminar
            </button>
          )}
        </div>
        {error && !editing && (
          <div className="mt-1 text-xs bg-red-50 text-red-800 rounded-md p-2 text-left">
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}
