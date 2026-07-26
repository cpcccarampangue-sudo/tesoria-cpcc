"use client";

import { useState, useTransition } from "react";
import type { CuotaPeriodo } from "@/lib/types";
import { togglePeriodoActivo, eliminarPeriodo } from "../actions";

export function PeriodoRow({
  p,
  montoLabel,
  vencLabel,
}: {
  p: CuotaPeriodo;
  montoLabel: string;
  vencLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  return (
    <tr className={p.activa ? "" : "opacity-50"}>
      <td className="table-td font-medium">{p.nombre}</td>
      <td className="table-td text-right">{montoLabel}</td>
      <td className="table-td">{vencLabel}</td>
      <td className="table-td">
        {p.activa ? (
          <span className="badge-green">Activa</span>
        ) : (
          <span className="badge-slate">Inactiva</span>
        )}
      </td>
      <td className="table-td text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            className="text-xs text-slate-600 hover:underline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await togglePeriodoActivo(p.id, !p.activa);
              })
            }
          >
            {p.activa ? "Desactivar" : "Reactivar"}
          </button>
          {confirm ? (
            <>
              <button
                className="text-xs text-red-700 font-semibold"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await eliminarPeriodo(p.id);
                  })
                }
              >
                Confirmar
              </button>
              <button
                className="text-xs text-slate-500"
                onClick={() => setConfirm(false)}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={() => setConfirm(true)}
              title="Elimina el período y todos los pagos asociados"
            >
              Eliminar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
