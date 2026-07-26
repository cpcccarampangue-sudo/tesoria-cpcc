"use client";

import { useState, useTransition } from "react";
import { getBoletaSignedUrl } from "../actions";

export function BoletaLink({ path }: { path: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      try {
        const url = await getBoletaSignedUrl(path);
        if (!url) throw new Error("No se pudo generar el enlace.");
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  return (
    <div>
      <button className="btn-secondary" onClick={open} disabled={pending}>
        {pending ? "Abriendo..." : "📎 Ver boleta"}
      </button>
      {error && (
        <div className="text-xs text-red-700 mt-1">{error}</div>
      )}
    </div>
  );
}
