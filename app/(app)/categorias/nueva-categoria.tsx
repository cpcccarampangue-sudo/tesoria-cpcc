"use client";

import { useState, useTransition } from "react";
import { crearCategoria } from "./actions";
import type { MovTipo } from "@/lib/types";

export function NuevaCategoria() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<MovTipo>("ingreso");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) {
      setError("Ingresa un nombre.");
      return;
    }
    startTransition(async () => {
      try {
        await crearCategoria({ nombre: nombre.trim(), tipo });
        setNombre("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 items-end">
      <div className="flex-1 min-w-[200px]">
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
          onChange={(e) => setTipo(e.target.value as MovTipo)}
        >
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
        </select>
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? "..." : "Agregar"}
      </button>
      {error && (
        <div className="w-full text-sm bg-red-50 text-red-800 rounded-md p-2 mt-2">
          {error}
        </div>
      )}
    </form>
  );
}
