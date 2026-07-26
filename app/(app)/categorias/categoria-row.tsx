"use client";

import { useState, useTransition } from "react";
import type { Categoria } from "@/lib/types";
import { toggleCategoria, eliminarCategoria } from "./actions";

export function CategoriaRow({ c }: { c: Categoria }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className={`py-2 flex items-center justify-between ${c.activa ? "" : "opacity-50"}`}>
      <span className="text-sm">{c.nombre}</span>
      <div className="flex items-center gap-3 text-xs">
        <button
          className="text-slate-600 hover:underline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await toggleCategoria(c.id, !c.activa);
            })
          }
        >
          {c.activa ? "Desactivar" : "Activar"}
        </button>
        {confirm ? (
          <>
            <button
              className="text-red-700 font-semibold"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await eliminarCategoria(c.id);
                })
              }
            >
              Confirmar
            </button>
            <button
              className="text-slate-500"
              onClick={() => setConfirm(false)}
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
    </li>
  );
}
