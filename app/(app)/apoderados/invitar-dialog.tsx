"use client";

import { useState, useTransition } from "react";
import {
  invitarContactosDeApoderado,
  type InvitacionResultado,
} from "./actions";

type Props = {
  apoderadoId: string;
  familiaNombre: string;
  cantidadContactos: number;
};

export function InvitarContactosDialog({
  apoderadoId,
  familiaNombre,
  cantidadContactos,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resultados, setResultados] = useState<InvitacionResultado[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  function abrir() {
    setResultados(null);
    setError(null);
    setOpen(true);
  }

  function ejecutar() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await invitarContactosDeApoderado(apoderadoId);
        setResultados(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  function descargarCSV() {
    if (!resultados) return;
    const filas = [
      ["Nombre", "Correo", "Contraseña temporal", "Estado"],
      ...resultados.map((r) => [
        r.nombre,
        r.email,
        r.password ?? "",
        r.status === "creada"
          ? "Cuenta creada"
          : r.status === "ya-existe"
          ? "Ya tenía cuenta"
          : `Error: ${r.motivo ?? ""}`,
      ]),
    ];
    const csv = filas
      .map((fila) =>
        fila
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(";")
      )
      .join("\r\n");
    // BOM para que Excel abra bien las tildes.
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invitaciones-${familiaNombre.replace(/\s+/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copiar(texto: string) {
    navigator.clipboard.writeText(texto).catch(() => {});
  }

  if (cantidadContactos === 0) return null;

  return (
    <>
      <button
        className="text-xs text-brand-700 hover:underline"
        onClick={abrir}
        type="button"
      >
        Invitar contactos
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                Invitar contactos — {familiaNombre}
              </h2>
              <button
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
                onClick={() => !pending && setOpen(false)}
                type="button"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!resultados && (
                <>
                  <p className="text-sm text-slate-700">
                    Se van a crear cuentas de acceso para los{" "}
                    <strong>{cantidadContactos}</strong> contactos con correo
                    de esta familia. Cada uno recibirá una contraseña temporal
                    autogenerada.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
                    <strong>Importante:</strong> las contraseñas se muestran una
                    sola vez. Guárdalas o descarga el CSV antes de cerrar.
                    Después no se pueden volver a ver — habría que
                    restablecerlas.
                  </div>
                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
                      {error}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn-secondary text-sm"
                      onClick={() => setOpen(false)}
                      disabled={pending}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="btn-primary text-sm"
                      onClick={ejecutar}
                      disabled={pending}
                      type="button"
                    >
                      {pending ? "Creando cuentas..." : "Crear cuentas"}
                    </button>
                  </div>
                </>
              )}

              {resultados && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-700">
                      {resultados.filter((r) => r.status === "creada").length}{" "}
                      cuentas creadas ·{" "}
                      {
                        resultados.filter((r) => r.status === "ya-existe")
                          .length
                      }{" "}
                      ya existían ·{" "}
                      {resultados.filter((r) => r.status === "error").length}{" "}
                      errores
                    </p>
                    <button
                      className="btn-secondary text-xs"
                      onClick={descargarCSV}
                      type="button"
                    >
                      Descargar CSV
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="table-th">Nombre</th>
                          <th className="table-th">Correo</th>
                          <th className="table-th">Contraseña temporal</th>
                          <th className="table-th">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {resultados.map((r, i) => (
                          <tr key={i}>
                            <td className="table-td">{r.nombre}</td>
                            <td className="table-td">
                              <div className="flex items-center gap-1">
                                <span className="truncate">{r.email}</span>
                                <button
                                  className="text-slate-400 hover:text-slate-700 text-xs"
                                  onClick={() => copiar(r.email)}
                                  title="Copiar correo"
                                  type="button"
                                >
                                  📋
                                </button>
                              </div>
                            </td>
                            <td className="table-td font-mono">
                              {r.password ? (
                                <div className="flex items-center gap-1">
                                  <span>{r.password}</span>
                                  <button
                                    className="text-slate-400 hover:text-slate-700 text-xs"
                                    onClick={() => copiar(r.password!)}
                                    title="Copiar contraseña"
                                    type="button"
                                  >
                                    📋
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="table-td text-xs">
                              {r.status === "creada" && (
                                <span className="badge-green">Creada</span>
                              )}
                              {r.status === "ya-existe" && (
                                <span className="badge-slate">
                                  Ya existía
                                </span>
                              )}
                              {r.status === "error" && (
                                <span
                                  className="badge-red"
                                  title={r.motivo}
                                >
                                  Error
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end">
                    <button
                      className="btn-secondary text-sm"
                      onClick={() => setOpen(false)}
                      type="button"
                    >
                      Cerrar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
