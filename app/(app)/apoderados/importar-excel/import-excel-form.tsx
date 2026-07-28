"use client";

import { useState, useTransition } from "react";
import { importarExcelFamilias, type ExcelImportResult } from "./actions";
import { parseCLPInput, formatNumber } from "@/lib/formatters";

export function ImportExcelForm() {
  const [file, setFile] = useState<File | null>(null);
  const [periodoNombre, setPeriodoNombre] = useState("Cuota Anual 2026");
  const [monto, setMonto] = useState("27000");
  const [generarPagos, setGenerarPagos] = useState(true);
  const [confirmarProduccion, setConfirmarProduccion] = useState(false);
  const [result, setResult] = useState<ExcelImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const montoNum = parseCLPInput(monto);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError("Selecciona el archivo Excel.");
      return;
    }
    if (!confirmarProduccion) {
      setError(
        "Marca la casilla de confirmación para importar (esta acción modifica datos)."
      );
      return;
    }
    if (generarPagos && (!periodoNombre.trim() || !montoNum)) {
      setError(
        "Si generas pagos, ingresa nombre de período y monto de la cuota."
      );
      return;
    }

    startTransition(async () => {
      try {
        const bytes = await file.arrayBuffer();
        const r = await importarExcelFamilias(bytes, {
          periodoNombre: generarPagos ? periodoNombre.trim() : null,
          montoDefault: montoNum ?? 0,
          generarPagos,
        });
        setResult(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Archivo Excel (.xlsx)</label>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {file && (
          <div className="text-xs text-slate-500 mt-1">
            {file.name} — {(file.size / 1024).toFixed(0)} KB
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <label className="flex items-center gap-2 text-sm font-medium mb-3">
          <input
            type="checkbox"
            checked={generarPagos}
            onChange={(e) => setGenerarPagos(e.target.checked)}
          />
          Generar período de cuota + registrar pagos de las familias socias
        </label>
        {generarPagos && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
            <div>
              <label className="label">Nombre del período</label>
              <input
                className="input"
                value={periodoNombre}
                onChange={(e) => setPeriodoNombre(e.target.value)}
                placeholder="Cuota Anual 2026"
              />
            </div>
            <div>
              <label className="label">Monto default (CLP)</label>
              <input
                className="input"
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
              {montoNum && (
                <div className="text-xs text-slate-500 mt-1">
                  ${formatNumber(montoNum)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmarProduccion}
          onChange={(e) => setConfirmarProduccion(e.target.checked)}
        />
        <span>
          Confirmo que quiero importar. Los contactos y estudiantes existentes
          de cada familia serán reemplazados.
        </span>
      </label>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      {result && (
        <div className="text-sm bg-green-50 text-green-900 rounded-md p-3 space-y-1">
          <div className="font-semibold">✅ Importación completada</div>
          <div>Familias procesadas: {result.familiasProcesadas}</div>
          <div>Familias creadas: {result.familiasCreadas}</div>
          <div>Familias actualizadas: {result.familiasActualizadas}</div>
          <div>Contactos cargados: {result.contactosCreados}</div>
          <div>Estudiantes cargados: {result.estudiantesCreados}</div>
          {result.cuotasPeriodoId && (
            <>
              <div>Cuotas pagadas registradas: {result.cuotasPagadas}</div>
            </>
          )}
          {result.errores.length > 0 && (
            <>
              <div className="font-semibold text-red-800 mt-2">
                Errores ({result.errores.length}):
              </div>
              <ul className="list-disc pl-5 max-h-64 overflow-y-auto">
                {result.errores.slice(0, 50).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {result.errores.length > 50 && (
                  <li>...y {result.errores.length - 50} más</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      <button className="btn-primary" disabled={pending}>
        {pending ? "Importando (puede tardar 30-60 segundos)..." : "Importar"}
      </button>
    </form>
  );
}
