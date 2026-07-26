"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearEvento } from "../actions";

export function EventoForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    fecha: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    startTransition(async () => {
      try {
        const id = await crearEvento({
          nombre: form.nombre,
          descripcion: form.descripcion || null,
          fecha: form.fecha || null,
        });
        router.push(`/eventos/${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label">Nombre *</label>
        <input
          className="input"
          value={form.nombre}
          onChange={(e) =>
            setForm((f) => ({ ...f, nombre: e.target.value }))
          }
          placeholder="Ej: Bingo Julio 2026"
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
      <div>
        <label className="label">Descripción</label>
        <textarea
          className="input"
          rows={3}
          value={form.descripcion}
          onChange={(e) =>
            setForm((f) => ({ ...f, descripcion: e.target.value }))
          }
        />
      </div>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Crear evento"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.back()}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
