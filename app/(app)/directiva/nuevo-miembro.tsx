"use client";

import { useState, useTransition } from "react";
import { crearMiembroDirectiva } from "./actions";
import { DIRECTIVA_CARGO_LABEL, DIRECTIVA_CARGO_ORDEN } from "@/lib/types";
import type { DirectivaCargo } from "@/lib/types";

export function NuevoMiembro() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [rut, setRut] = useState("");
  const [cargo, setCargo] = useState<DirectivaCargo>("tesorero");
  const [activo, setActivo] = useState(true);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Ingresa un nombre.");
    startTransition(async () => {
      try {
        await crearMiembroDirectiva({
          nombre: nombre.trim(),
          rut: rut.trim(),
          cargo,
          activo,
        });
        setNombre("");
        setRut("");
        setActivo(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
      <div className="md:col-span-2">
        <label className="label">Nombre completo</label>
        <input
          className="input"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Juana Pérez González"
        />
      </div>
      <div>
        <label className="label">RUT (opcional)</label>
        <input
          className="input"
          value={rut}
          onChange={(e) => setRut(e.target.value)}
          placeholder="12.345.678-9"
        />
      </div>
      <div>
        <label className="label">Cargo</label>
        <select
          className="input"
          value={cargo}
          onChange={(e) => setCargo(e.target.value as DirectivaCargo)}
        >
          {DIRECTIVA_CARGO_ORDEN.map((c) => (
            <option key={c} value={c}>
              {DIRECTIVA_CARGO_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm md:col-span-3">
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
        />
        Marcar como el/la <strong>{DIRECTIVA_CARGO_LABEL[cargo].toLowerCase()}</strong>{" "}
        activo/a (se desactiva al anterior si lo hubiera)
      </label>
      <button className="btn-primary md:col-span-1" disabled={pending}>
        {pending ? "Guardando..." : "Agregar miembro"}
      </button>
      {error && (
        <div className="md:col-span-4 text-sm bg-red-50 text-red-800 rounded-md p-2">
          {error}
        </div>
      )}
    </form>
  );
}
