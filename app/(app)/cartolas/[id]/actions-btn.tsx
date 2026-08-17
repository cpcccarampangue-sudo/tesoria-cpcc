"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eliminarCartola, getCartolaSignedUrl } from "../actions";

export function CartolaHeaderActions({
  cartolaId,
  archivoPath,
  archivoNombre,
}: {
  cartolaId: string;
  archivoPath: string;
  archivoNombre: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openArchivo() {
    setError(null);
    const url = await getCartolaSignedUrl(archivoPath);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("No se pudo generar el enlace.");
  }

  function doDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await eliminarCartola(cartolaId);
        router.push("/cartolas");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
        setConfirm(false);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary text-sm" onClick={openArchivo}>
        📎 {archivoNombre ?? "Ver archivo"}
      </button>
      {!confirm ? (
        <button
          type="button"
          className="text-xs text-red-600 hover:underline"
          onClick={() => setConfirm(true)}
        >
          Eliminar cartola
        </button>
      ) : (
        <div className="inline-flex items-center gap-2">
          <span className="text-xs text-slate-600">
            Se borrarán {"("}líneas + archivo{")"}. ¿Confirmas?
          </span>
          <button
            className="btn-danger text-xs"
            disabled={pending}
            onClick={doDelete}
          >
            Sí
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={() => setConfirm(false)}
          >
            No
          </button>
        </div>
      )}
      {error && (
        <div className="text-xs text-red-700 w-full">{error}</div>
      )}
    </div>
  );
}
