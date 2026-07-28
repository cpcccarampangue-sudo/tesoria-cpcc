"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  actualizarApoderado,
  type EstudianteInput,
  type ContactoInput,
} from "../actions";
import { EstudiantesEditor } from "@/components/estudiantes-editor";
import { ContactosEditor } from "@/components/contactos-editor";
import type { Apoderado, Contacto, Estudiante } from "@/lib/types";

export function EditarApoderadoForm({
  apoderado,
  contactos,
  estudiantes,
}: {
  apoderado: Apoderado;
  contactos: Contacto[];
  estudiantes: Estudiante[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [form, setForm] = useState({
    nombre: apoderado.nombre,
    activo: apoderado.activo,
    socio: apoderado.socio,
  });
  const [cts, setCts] = useState<ContactoInput[]>(
    contactos.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      email: c.email,
      telefono: c.telefono,
      relacion: c.relacion,
    }))
  );
  const [ests, setEsts] = useState<EstudianteInput[]>(
    estudiantes.map((e) => ({ id: e.id, nombre: e.nombre, curso: e.curso }))
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!form.nombre.trim()) {
      setError("El nombre de la familia es obligatorio.");
      return;
    }
    startTransition(async () => {
      try {
        await actualizarApoderado(apoderado.id, {
          nombre: form.nombre,
          activo: form.activo,
          socio: form.socio,
          contactos: cts,
          estudiantes: ests,
        });
        setOk(true);
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
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.activo}
            onChange={(e) =>
              setForm((f) => ({ ...f, activo: e.target.checked }))
            }
          />
          Familia activa
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.socio}
            onChange={(e) =>
              setForm((f) => ({ ...f, socio: e.target.checked }))
            }
          />
          Socio del CdP
        </label>
      </div>
      <div>
        <label className="label">Contactos</label>
        <ContactosEditor value={cts} onChange={setCts} />
      </div>
      <div>
        <label className="label">Estudiantes (hijos)</label>
        <EstudiantesEditor value={ests} onChange={setEsts} />
      </div>
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
