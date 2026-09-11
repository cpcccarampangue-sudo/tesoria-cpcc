"use client";

import { useState, useTransition } from "react";
import type { DirectivaMiembro, DirectivaCargo } from "@/lib/types";
import { DIRECTIVA_CARGO_LABEL, DIRECTIVA_CARGO_ORDEN } from "@/lib/types";
import {
  actualizarMiembroDirectiva,
  eliminarMiembroDirectiva,
  toggleMiembroDirectiva,
} from "./actions";

export function MiembroRow({ m }: { m: DirectivaMiembro }) {
  const [pending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState(m.nombre);
  const [rut, setRut] = useState(m.rut);
  const [cargo, setCargo] = useState<DirectivaCargo>(m.cargo);

  function guardar() {
    setError(null);
    startTransition(async () => {
      try {
        await actualizarMiembroDirectiva(m.id, {
          nombre: nombre.trim(),
          rut: rut.trim(),
          cargo,
        });
        setEditando(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        await toggleMiembroDirectiva(m.id, !m.activo);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function eliminar() {
    setError(null);
    startTransition(async () => {
      try {
        await eliminarMiembroDirectiva(m.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  if (editando) {
    return (
      <tr className="border-b border-slate-100">
        <td className="py-2 pr-2">
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </td>
        <td className="py-2 pr-2">
          <input
            className="input"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
          />
        </td>
        <td className="py-2 pr-2">
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
        </td>
        <td className="py-2 pr-2 text-xs">
          {m.activo ? (
            <span className="badge-green">Activo</span>
          ) : (
            <span className="badge-slate">Inactivo</span>
          )}
        </td>
        <td className="py-2 pr-2 text-right">
          <button
            className="btn-primary text-xs"
            onClick={guardar}
            disabled={pending}
          >
            {pending ? "..." : "Guardar"}
          </button>
          <button
            className="btn-secondary text-xs ml-1"
            onClick={() => setEditando(false)}
            disabled={pending}
          >
            Cancelar
          </button>
          {error && (
            <div className="text-xs text-red-700 mt-1">{error}</div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b border-slate-100 ${m.activo ? "" : "opacity-60"}`}>
      <td className="py-2 pr-2 font-medium">{m.nombre}</td>
      <td className="py-2 pr-2 font-mono text-xs">{m.rut}</td>
      <td className="py-2 pr-2">
        <span className="badge-blue">{DIRECTIVA_CARGO_LABEL[m.cargo]}</span>
      </td>
      <td className="py-2 pr-2 text-xs">
        {m.activo ? (
          <span className="badge-green">Activo</span>
        ) : (
          <span className="badge-slate">Inactivo</span>
        )}
      </td>
      <td className="py-2 pr-2 text-right text-xs">
        <button
          className="text-slate-600 hover:underline mr-3"
          onClick={() => setEditando(true)}
          disabled={pending}
        >
          Editar
        </button>
        <button
          className="text-slate-600 hover:underline mr-3"
          onClick={toggle}
          disabled={pending}
        >
          {m.activo ? "Desactivar" : "Activar"}
        </button>
        {confirm ? (
          <>
            <button
              className="text-red-700 font-semibold mr-2"
              onClick={eliminar}
              disabled={pending}
            >
              Confirmar
            </button>
            <button
              className="text-slate-500"
              onClick={() => setConfirm(false)}
              disabled={pending}
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
        {error && <div className="text-xs text-red-700 mt-1">{error}</div>}
      </td>
    </tr>
  );
}
