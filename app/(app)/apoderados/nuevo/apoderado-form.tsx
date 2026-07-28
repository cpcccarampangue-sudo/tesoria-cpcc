"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  crearApoderado,
  type EstudianteInput,
  type ContactoInput,
} from "../actions";
import { EstudiantesEditor } from "@/components/estudiantes-editor";
import { ContactosEditor } from "@/components/contactos-editor";

export function ApoderadoForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    socio: true,
  });
  const [contactos, setContactos] = useState<ContactoInput[]>([]);
  const [estudiantes, setEstudiantes] = useState<EstudianteInput[]>([]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.nombre.trim()) {
      setError("El nombre de la familia es obligatorio.");
      return;
    }
    startTransition(async () => {
      try {
        await crearApoderado({
          nombre: form.nombre,
          socio: form.socio,
          contactos,
          estudiantes,
        });
        router.push("/apoderados");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nombre de la familia *</label>
        <input
          className="input"
          value={form.nombre}
          onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
          required
          placeholder="Ej: Cáceres Pérez"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.socio}
          onChange={(e) => setForm((f) => ({ ...f, socio: e.target.checked }))}
        />
        Socio del Centro de Padres
      </label>
      <div>
        <label className="label">Contactos (padre, madre, apoderado...)</label>
        <ContactosEditor value={contactos} onChange={setContactos} />
      </div>
      <div>
        <label className="label">Estudiantes (hijos)</label>
        <EstudiantesEditor value={estudiantes} onChange={setEstudiantes} />
      </div>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Guardar familia"}
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
