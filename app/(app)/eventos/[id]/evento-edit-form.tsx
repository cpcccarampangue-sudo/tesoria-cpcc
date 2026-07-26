"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Evento } from "@/lib/types";
import { actualizarEvento, eliminarEvento } from "../actions";

export function EventoEditForm({ evento }: { evento: Evento }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: evento.nombre,
    descripcion: evento.descripcion ?? "",
    fecha: evento.fecha ?? "",
    cerrado: evento.cerrado,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await actualizarEvento(evento.id, {
          nombre: form.nombre,
          descripcion: form.descripcion || null,
          fecha: form.fecha || null,
          cerrado: form.cerrado,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={form.nombre}
            onChange={(e) =>
              setForm((f) => ({ ...f, nombre: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="label">Fecha</label>
          <input
            type="date"
            className="input"
            value={form.fecha}
            onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <label className="label">Descripción</label>
        <textarea
          className="input"
          rows={2}
          value={form.descripcion}
          onChange={(e) =>
            setForm((f) => ({ ...f, descripcion: e.target.value }))
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.cerrado}
          onChange={(e) =>
            setForm((f) => ({ ...f, cerrado: e.target.checked }))
          }
        />
        Cerrar evento (deja de aceptar movimientos)
      </label>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
        {confirm ? (
          <>
            <span className="text-xs text-red-700">
              Se eliminará el evento y sus movimientos quedarán sin evento.
            </span>
            <button
              type="button"
              className="btn-danger text-xs"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await eliminarEvento(evento.id);
                  router.push("/eventos");
                })
              }
            >
              Confirmar eliminación
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setConfirm(false)}
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-xs text-red-600 hover:underline ml-auto"
            onClick={() => setConfirm(true)}
          >
            Eliminar evento
          </button>
        )}
      </div>
    </form>
  );
}
