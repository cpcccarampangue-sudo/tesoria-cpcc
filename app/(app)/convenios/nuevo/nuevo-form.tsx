"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearConvenio } from "../actions";

export function NuevoConvenioForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    logo_url: "",
    valid_from: "",
    valid_until: "",
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const id = await crearConvenio({
          nombre: form.nombre,
          descripcion: form.descripcion,
          logo_url: form.logo_url,
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
        });
        router.push(`/convenios/${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Nombre del convenio</label>
        <input
          className="input"
          required
          minLength={2}
          value={form.nombre}
          onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
          placeholder="Ej: Librería Papelandia"
        />
      </div>

      <div>
        <label className="label">
          Descripción{" "}
          <span className="text-xs text-slate-500 font-normal">(opcional)</span>
        </label>
        <textarea
          className="input min-h-[80px]"
          value={form.descripcion}
          onChange={(e) =>
            setForm((f) => ({ ...f, descripcion: e.target.value }))
          }
          placeholder="Ej: 10% de descuento en útiles escolares, no acumulable con otras ofertas."
        />
      </div>

      <div>
        <label className="label">
          URL del logo{" "}
          <span className="text-xs text-slate-500 font-normal">(opcional)</span>
        </label>
        <input
          className="input"
          value={form.logo_url}
          onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
          placeholder="https://..."
        />
        <p className="text-xs text-slate-500 mt-1">
          Puede ser un enlace de Google Drive público o cualquier URL de
          imagen accesible por internet.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">
            Vigente desde{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            type="date"
            className="input"
            value={form.valid_from}
            onChange={(e) =>
              setForm((f) => ({ ...f, valid_from: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="label">
            Vigente hasta{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            type="date"
            className="input"
            value={form.valid_until}
            onChange={(e) =>
              setForm((f) => ({ ...f, valid_until: e.target.value }))
            }
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="text-sm bg-red-50 text-red-800 rounded-md p-3"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={pending || !form.nombre.trim()}
        >
          {pending ? "Guardando…" : "Crear convenio"}
        </button>
      </div>
    </form>
  );
}
