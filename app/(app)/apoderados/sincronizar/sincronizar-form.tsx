"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { sincronizarDesdeGoogleSheets } from "../importar-excel/actions";
import type { ExcelImportResult } from "../importar-excel/actions";
import { parseCLPInput, formatNumber } from "@/lib/formatters";

const LS_KEY = "tesoria-cpcc-sheet-url";

export function SincronizarForm() {
  const router = useRouter();
  const [sheetUrl, setSheetUrl] = useState("");
  const [periodoNombre, setPeriodoNombre] = useState("Cuota Anual 2026");
  const [monto, setMonto] = useState("27000");
  const [generarPagos, setGenerarPagos] = useState(true);
  const [regaloEnabled, setRegaloEnabled] = useState(true);
  const [regaloDescNormal, setRegaloDescNormal] = useState("Agenda escolar");
  const [regaloValorNormal, setRegaloValorNormal] = useState("10000");
  const [regaloDescPre, setRegaloDescPre] = useState("Agenda preescolar");
  const [regaloValorPre, setRegaloValorPre] = useState("6000");
  const [confirmar, setConfirmar] = useState(false);
  const [result, setResult] = useState<ExcelImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Recordar la URL del sheet
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) setSheetUrl(saved);
  }, []);

  useEffect(() => {
    if (sheetUrl) localStorage.setItem(LS_KEY, sheetUrl);
  }, [sheetUrl]);

  const montoNum = parseCLPInput(monto);
  const regaloValorNormalNum = parseCLPInput(regaloValorNormal);
  const regaloValorPreNum = parseCLPInput(regaloValorPre);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!sheetUrl.trim()) {
      setError("Pega la URL del Google Sheets.");
      return;
    }
    if (!confirmar) {
      setError("Marca la casilla de confirmación.");
      return;
    }
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("sheetUrl", sheetUrl.trim());
        fd.append("generarPagos", generarPagos ? "1" : "0");
        fd.append("periodoNombre", periodoNombre.trim());
        fd.append("montoDefault", String(montoNum ?? 0));
        fd.append("regaloEnabled", regaloEnabled ? "1" : "0");
        fd.append("regaloDescripcionNormal", regaloDescNormal.trim());
        fd.append("regaloValorNormal", String(regaloValorNormalNum ?? 0));
        fd.append("regaloDescripcionPrescolar", regaloDescPre.trim());
        fd.append("regaloValorPrescolar", String(regaloValorPreNum ?? 0));
        const r = await sincronizarDesdeGoogleSheets(fd);
        setResult(r);
        router.refresh(); // fuerza refresh de RSC cache
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">URL del Google Sheets</label>
        <input
          className="input"
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
        <div className="text-xs text-slate-500 mt-1">
          Se recuerda para próximas veces (queda guardada en tu navegador).
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <label className="flex items-center gap-2 text-sm font-medium mb-3">
          <input
            type="checkbox"
            checked={generarPagos}
            onChange={(e) => setGenerarPagos(e.target.checked)}
          />
          Registrar pagos de cuota + crear período
        </label>
        {generarPagos && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
            <div>
              <label className="label">Nombre del período</label>
              <input
                className="input"
                value={periodoNombre}
                onChange={(e) => setPeriodoNombre(e.target.value)}
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

      <div className="border-t border-slate-200 pt-4">
        <label className="flex items-center gap-2 text-sm font-medium mb-3">
          <input
            type="checkbox"
            checked={regaloEnabled}
            onChange={(e) => setRegaloEnabled(e.target.checked)}
          />
          Registrar regalo por incorporación (agenda u otra mercadería)
        </label>
        {regaloEnabled && (
          <div className="pl-6 space-y-3">
            <p className="text-xs text-slate-500">
              El regalo se asigna a las familias socias que tengan la columna{" "}
              <code>agenda</code> marcada en el sheet. Si tienen algún hijo en
              preescolar (K/PK/MM), se usa el regalo &quot;preescolar&quot;.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Descripción regalo normal</label>
                <input
                  className="input"
                  value={regaloDescNormal}
                  onChange={(e) => setRegaloDescNormal(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Costo unitario (CLP)</label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={regaloValorNormal}
                  onChange={(e) => setRegaloValorNormal(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Descripción regalo preescolar</label>
                <input
                  className="input"
                  value={regaloDescPre}
                  onChange={(e) => setRegaloDescPre(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Costo unitario (CLP)</label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={regaloValorPre}
                  onChange={(e) => setRegaloValorPre(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmar}
          onChange={(e) => setConfirmar(e.target.checked)}
        />
        <span>
          Confirmo. Los contactos, estudiantes y pagos de las familias del
          sheet serán reemplazados con los datos descargados.
        </span>
      </label>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      {result && (
        <div className="text-sm bg-green-50 text-green-900 rounded-md p-3 space-y-1">
          <div className="font-semibold">✅ Sincronización terminada</div>
          <div>Familias procesadas: {result.familiasProcesadas}</div>
          <div>Familias creadas: {result.familiasCreadas}</div>
          <div>Familias actualizadas: {result.familiasActualizadas}</div>
          <div>Contactos cargados: {result.contactosCreados}</div>
          <div>Estudiantes cargados: {result.estudiantesCreados}</div>
          {result.cuotasPeriodoId && (
            <>
              <div>Cuotas pagadas registradas: {result.cuotasPagadas}</div>
              <div>Regalos entregados: {result.regalosRegistrados}</div>
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
        {pending
          ? "Sincronizando (puede tardar 10-30 segundos)..."
          : "Sincronizar desde Google Sheets"}
      </button>
    </form>
  );
}
