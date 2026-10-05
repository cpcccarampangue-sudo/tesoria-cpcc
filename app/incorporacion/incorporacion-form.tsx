"use client";

import { useState, useTransition } from "react";
import type { SocioConfig } from "@/lib/types";
import { CURSO_GRUPOS, CURSO_LETRAS } from "@/lib/cursos";
import { crearSolicitudSocio } from "./actions";

export function IncorporacionForm({ config }: { config: SocioConfig }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    apoderado_nombre: "",
    apoderado_email: "",
    apoderado_rut: "",
    apoderado_telefono: "",
    alumno_nombre: "",
    curso: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await crearSolicitudSocio(form);
      } catch (err) {
        // Next lanza NEXT_REDIRECT como "error" cuando se hace redirect dentro
        // de una server action: lo dejamos pasar, el redirect ocurre solo.
        if (
          err instanceof Error &&
          "digest" in err &&
          String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label">Nombre del apoderado</label>
        <input
          className="input"
          value={form.apoderado_nombre}
          onChange={(e) =>
            setForm((f) => ({ ...f, apoderado_nombre: e.target.value }))
          }
          placeholder="Ej: María Pérez González"
          required
          autoComplete="name"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Correo electrónico</label>
          <input
            type="email"
            className="input"
            value={form.apoderado_email}
            onChange={(e) =>
              setForm((f) => ({ ...f, apoderado_email: e.target.value }))
            }
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
          />
          <p className="text-xs text-slate-500 mt-1">
            Aquí llegará tu código QR cuando confirmemos el pago.
          </p>
        </div>
        <div>
          <label className="label">
            Teléfono{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={form.apoderado_telefono}
            onChange={(e) =>
              setForm((f) => ({ ...f, apoderado_telefono: e.target.value }))
            }
            placeholder="+56 9 1234 5678"
            autoComplete="tel"
          />
        </div>
      </div>

      <div>
        <label className="label">
          RUT{" "}
          <span className="text-xs text-slate-500 font-normal">
            (opcional)
          </span>
        </label>
        <input
          className="input"
          value={form.apoderado_rut}
          onChange={(e) =>
            setForm((f) => ({ ...f, apoderado_rut: e.target.value }))
          }
          placeholder="12.345.678-9"
        />
      </div>

      <div className="border-t border-slate-200 pt-3 mt-4">
        <h3 className="font-medium text-slate-800 mb-2">Datos del alumno</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre del alumno</label>
            <input
              className="input"
              value={form.alumno_nombre}
              onChange={(e) =>
                setForm((f) => ({ ...f, alumno_nombre: e.target.value }))
              }
              placeholder="Ej: Juan Pérez"
              required
            />
          </div>
          <div>
            <label className="label">Curso</label>
            <select
              className="input"
              value={form.curso}
              onChange={(e) =>
                setForm((f) => ({ ...f, curso: e.target.value }))
              }
              required
            >
              <option value="">— seleccionar —</option>
              {CURSO_GRUPOS.map((grupo) => (
                <optgroup key={grupo.nombre} label={grupo.nombre}>
                  {grupo.niveles.flatMap((nivel) =>
                    CURSO_LETRAS.map((letra) => (
                      <option key={`${nivel}-${letra}`} value={`${nivel} ${letra}`}>
                        {nivel} {letra}
                      </option>
                    ))
                  )}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 mt-4">
        <strong>Monto a pagar:</strong> $
        {config.monto_cuota.toLocaleString("es-CL")} CLP · Año{" "}
        {config.periodo_anio}
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={pending}
      >
        {pending ? "Procesando..." : "Continuar al pago →"}
      </button>

      <p className="text-xs text-slate-500 text-center pt-2">
        Al continuar aceptas que el Centro de Padres guarde tus datos para
        emitir tu condición de socio. No compartimos tus datos con terceros.
      </p>
    </form>
  );
}
