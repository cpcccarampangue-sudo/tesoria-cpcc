"use client";

import { useState, useTransition } from "react";
import { importarApoderadosCSV } from "../actions";

type Result = Awaited<ReturnType<typeof importarApoderadosCSV>>;

export function ImportForm() {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ""));
    };
    reader.readAsText(f, "utf-8");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!csv.trim()) {
      setError("Pega el contenido del CSV o sube un archivo.");
      return;
    }
    startTransition(async () => {
      try {
        const r = await importarApoderadosCSV(csv);
        setResult(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Archivo CSV (opcional)</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>
      <div>
        <label className="label">O pega el CSV aquí</label>
        <textarea
          className="input font-mono text-xs"
          rows={12}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="nombre,email,telefono,curso,nombre_estudiante&#10;María Pérez,maria@correo.cl,+56 9 ...,5°B,Juan Pérez"
        />
      </div>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      {result && (
        <div className="text-sm bg-green-50 text-green-900 rounded-md p-3 space-y-1">
          <div>Filas procesadas: {result.filas}</div>
          <div>Insertados: {result.insertados}</div>
          <div>Actualizados: {result.actualizados}</div>
          {result.errores.length > 0 && (
            <>
              <div className="font-semibold text-red-800 mt-2">
                Errores ({result.errores.length}):
              </div>
              <ul className="list-disc pl-5">
                {result.errores.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Fila {e.fila}: {e.motivo}
                  </li>
                ))}
                {result.errores.length > 20 && (
                  <li>
                    ...y {result.errores.length - 20} más
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Importando..." : "Importar"}
        </button>
      </div>
    </form>
  );
}
