"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  actualizarConvenio,
  desactivarConvenio,
  reactivarConvenio,
  agregarOperador,
  revocarOperador,
  reactivarOperador,
} from "../actions";
import type { ConvenioConOperadores } from "../tipos";

export function ConvenioDetalleForm({
  convenio,
}: {
  convenio: ConvenioConOperadores;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: convenio.nombre,
    descripcion: convenio.descripcion ?? "",
    logo_url: convenio.logo_url ?? "",
    valid_from: convenio.valid_from ?? "",
    valid_until: convenio.valid_until ?? "",
  });
  const [emailNuevo, setEmailNuevo] = useState("");

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await actualizarConvenio({
          id: convenio.id,
          nombre: form.nombre,
          descripcion: form.descripcion,
          logo_url: form.logo_url,
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function toggleActivo() {
    setError(null);
    startTransition(async () => {
      try {
        if (convenio.active) {
          if (
            !confirm(
              "Desactivar el convenio invalida el acceso de sus operadores. ¿Confirmar?"
            )
          )
            return;
          await desactivarConvenio(convenio.id);
        } else {
          await reactivarConvenio(convenio.id);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const em = emailNuevo.trim();
    if (!em) return;
    startTransition(async () => {
      try {
        await agregarOperador(convenio.id, em);
        setEmailNuevo("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function revocar(id: string) {
    if (!confirm("Revocar acceso de este operador al validador?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await revocarOperador(id);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function reactivar(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await reactivarOperador(id);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Datos del convenio */}
      <section className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
          Datos del convenio
        </h2>

        <form onSubmit={guardar} className="space-y-3">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              required
              minLength={2}
              value={form.nombre}
              onChange={(e) =>
                setForm((f) => ({ ...f, nombre: e.target.value }))
              }
            />
          </div>

          <div>
            <label className="label">Descripción</label>
            <textarea
              className="input min-h-[80px]"
              value={form.descripcion}
              onChange={(e) =>
                setForm((f) => ({ ...f, descripcion: e.target.value }))
              }
            />
          </div>

          <div>
            <label className="label">URL del logo</label>
            <input
              className="input"
              value={form.logo_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, logo_url: e.target.value }))
              }
              placeholder="https://..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Vigente desde</label>
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
              <label className="label">Vigente hasta</label>
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

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="btn-primary"
              disabled={pending || !form.nombre.trim()}
            >
              {pending ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending}
              onClick={toggleActivo}
            >
              {convenio.active ? "Desactivar" : "Reactivar"}
            </button>
          </div>
        </form>
      </section>

      {/* Operadores */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
            Operadores autorizados
          </h2>
          <span className="text-xs text-slate-500">
            {convenio.operadores.filter((o) => o.active).length} activos
          </span>
        </div>
        <p className="text-xs text-slate-600 -mt-2">
          Cada correo acá podrá autenticarse en /validar con OTP y validar
          credenciales en nombre de este convenio.
        </p>

        <form onSubmit={agregar} className="flex gap-2">
          <input
            type="email"
            className="input flex-1"
            placeholder="operador@comercio.cl"
            value={emailNuevo}
            onChange={(e) => setEmailNuevo(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={pending || !emailNuevo.trim()}
          >
            + Agregar
          </button>
        </form>

        {convenio.operadores.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-4">
            Este convenio aún no tiene operadores.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {convenio.operadores.map((op) => (
              <li
                key={op.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-slate-900 truncate">
                    {op.email_normalized}
                  </div>
                  {!op.active && op.revoked_at && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      Revocado el{" "}
                      {new Date(op.revoked_at).toLocaleDateString("es-CL")}
                    </div>
                  )}
                </div>
                {op.active ? (
                  <>
                    <span className="badge-green">activo</span>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => revocar(op.id)}
                      disabled={pending}
                    >
                      Revocar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="badge-slate">revocado</span>
                    <button
                      type="button"
                      className="text-xs text-brand-700 hover:underline"
                      onClick={() => reactivar(op.id)}
                      disabled={pending}
                    >
                      Reactivar
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="text-sm bg-red-50 text-red-800 rounded-md p-3"
        >
          {error}
        </div>
      )}
    </div>
  );
}
