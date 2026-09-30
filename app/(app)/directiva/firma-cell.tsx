"use client";

import { useRef, useState, useTransition } from "react";
import { subirFirmaMiembro, eliminarFirmaMiembro } from "./actions";

export function FirmaCell({
  miembroId,
  firmaUrl,
}: {
  miembroId: string;
  firmaUrl: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(file: File) {
    setError(null);
    setConfirmDel(false);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("firma", file);
        await subirFirmaMiembro(miembroId, fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al subir");
      }
    });
  }

  function eliminar() {
    setError(null);
    startTransition(async () => {
      try {
        await eliminarFirmaMiembro(miembroId);
        setConfirmDel(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {firmaUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={firmaUrl}
            alt="Firma"
            className="h-10 w-auto max-w-[110px] object-contain border border-slate-200 bg-white rounded"
          />
          <div className="flex flex-col gap-0.5 text-xs">
            <button
              type="button"
              className="text-slate-600 hover:underline text-left"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
            >
              Cambiar
            </button>
            {confirmDel ? (
              <span className="flex gap-1">
                <button
                  type="button"
                  className="text-red-700 font-semibold"
                  onClick={eliminar}
                  disabled={pending}
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  className="text-slate-500"
                  onClick={() => setConfirmDel(false)}
                  disabled={pending}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-red-600 hover:underline text-left"
                onClick={() => setConfirmDel(true)}
                disabled={pending}
              >
                Eliminar
              </button>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
        >
          {pending ? "Procesando..." : "Subir firma"}
        </button>
      )}
      {error && <div className="text-xs text-red-700">{error}</div>}
    </div>
  );
}
