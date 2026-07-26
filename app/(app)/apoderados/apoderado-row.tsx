"use client";

import { useState, useTransition } from "react";
import type { Apoderado } from "@/lib/types";
import { toggleActivo, eliminarApoderado } from "./actions";

export function ApoderadoRow({
  a,
  altaLabel,
}: {
  a: Apoderado;
  altaLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  return (
    <tr className={a.activo ? "" : "opacity-50"}>
      <td className="table-td font-medium">{a.nombre}</td>
      <td className="table-td">{a.nombre_estudiante ?? "—"}</td>
      <td className="table-td">{a.curso ?? "—"}</td>
      <td className="table-td">{a.email ?? "—"}</td>
      <td className="table-td">{a.telefono ?? "—"}</td>
      <td className="table-td">{altaLabel}</td>
      <td className="table-td text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            className="text-xs text-slate-600 hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await toggleActivo(a.id, !a.activo);
              })
            }
          >
            {a.activo ? "Desactivar" : "Reactivar"}
          </button>
          {confirm ? (
            <>
              <button
                className="text-xs text-red-700 font-semibold"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await eliminarApoderado(a.id);
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
            >
              Eliminar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
