"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearApoderado } from "../actions";

export function ApoderadoForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    email: "",
    telefono: "",
    curso: "",
    nombre_estudiante: "",
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
        await crearApoderado(form);
        router.push("/apoderados");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  function upd<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nombre completo *</label>
        <input
          className="input"
          value={form.nombre}
          onChange={(e) => upd("nombre", e.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => upd("email", e.target.value)}
            placeholder="opcional"
          />
        </div>
        <div>
          <label className="label">Teléfono</label>
          <input
            className="input"
            value={form.telefono}
            onChange={(e) => upd("telefono", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Curso</label>
          <input
            className="input"
            value={form.curso}
            onChange={(e) => upd("curso", e.target.value)}
            placeholder="Ej: 5°B"
          />
        </div>
        <div>
          <label className="label">Estudiante</label>
          <input
            className="input"
            value={form.nombre_estudiante}
            onChange={(e) => upd("nombre_estudiante", e.target.value)}
          />
        </div>
      </div>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
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
