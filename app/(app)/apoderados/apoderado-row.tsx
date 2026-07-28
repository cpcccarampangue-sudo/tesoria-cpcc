"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Apoderado, Estudiante } from "@/lib/types";
import { toggleActivo, eliminarApoderado } from "./actions";

export function ApoderadoRow({
  a,
  estudiantes,
  altaLabel,
}: {
  a: Apoderado;
  estudiantes: Estudiante[];
  altaLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  return (
    <tr className={a.activo ? "" : "opacity-50"}>
      <td className="table-td font-medium">
        <Link
          href={`/apoderados/${a.id}`}
          className="text-brand-700 hover:underline"
        >
          {a.nombre}
        </Link>
      </td>
      <td className="table-td">
        {estudiantes.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <div className="space-y-0.5">
            {estudiantes.map((e) => (
              <div key={e.id} className="text-xs">
                <span className="font-medium">{e.nombre}</span>
                {e.curso && (
                  <span className="text-slate-500"> ({e.curso})</span>
                )}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="table-td">{a.email ?? "—"}</td>
      <td className="table-td">{a.telefono ?? "—"}</td>
      <td className="table-td">{altaLabel}</td>
      <td className="table-td text-right">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/apoderados/${a.id}`}
            className="text-xs text-slate-600 hover:underline"
          >
            Editar
          </Link>
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
