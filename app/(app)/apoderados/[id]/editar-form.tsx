"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actualizarApoderado, type EstudianteInput } from "../actions";
import { EstudiantesEditor } from "@/components/estudiantes-editor";
import type { Apoderado, Estudiante } from "@/lib/types";

export function EditarApoderadoForm({
  apoderado,
  estudiantes,
}: {
  apoderado: Apoderado;
  estudiantes: Estudiante[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [form, setForm] = useState({
    nombre: apoderado.nombre,
    email: apoderado.email ?? "",
    telefono: apoderado.telefono ?? "",
    activo: apoderado.activo,
  });
  const [ests, setEsts] = useState<EstudianteInput[]>(
    estudiantes.map((e) => ({ id: e.id, nombre: e.nombre, curso: e.curso }))
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!form.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    startTransition(async () => {
      try {
        await actualizarApoderado(apoderado.id, {
          nombre: form.nombre,
          email: form.email,
          telefono: form.telefono,
          activo: form.activo,
          estudiantes: ests,
        });
        setOk(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  function upd<K extends "nombre" | "email" | "telefono">(k: K, v: string) {
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
      </div>
      <div>
        <label className="label">Hijos (estudiantes)</label>
        <EstudiantesEditor value={ests} onChange={setEsts} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.activo}
          onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
        />
        Apoderado activo
      </label>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      {ok && (
        <div className="text-sm bg-green-50 text-green-800 rounded-md p-3">
          Cambios guardados.
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push("/apoderados")}
        >
          Volver
        </button>
      </div>
    </form>
  );
}
