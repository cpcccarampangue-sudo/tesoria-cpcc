"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

type ResultadoValidacion =
  | {
      estado: "activo";
      apoderado: string;
      hijos: Array<{ nombre: string; curso: string | null }>;
      periodo: number;
      pagadaEn: string | null;
    }
  | {
      estado: "no_valido";
      motivo: string;
    };

export function ValidadorClient() {
  const [scanning, setScanning] = useState(false);
  const [resultado, setResultado] = useState<ResultadoValidacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "qr-reader-container";

  useEffect(() => {
    // Cleanup al desmontar: detener la camara si quedo activa.
    return () => {
      scannerRef.current?.stop().catch(() => {});
      scannerRef.current?.clear();
      scannerRef.current = null;
    };
  }, []);

  async function iniciarEscaneo() {
    setError(null);
    setResultado(null);
    setScanning(true);

    try {
      // Import dinamico para evitar que la libreria (que usa canvas y
      // getUserMedia) se cargue en el servidor.
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
        },
        async (decodedText) => {
          // Al detectar un QR, detenemos la camara y validamos.
          await scanner.stop().catch(() => {});
          setScanning(false);
          await validar(decodedText);
        },
        () => {
          // Error de frame (sin QR detectado), lo ignoramos.
        }
      );
    } catch (err) {
      setScanning(false);
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo acceder a la cámara. Autoriza el permiso e inténtalo de nuevo."
      );
    }
  }

  async function cancelarEscaneo() {
    await scannerRef.current?.stop().catch(() => {});
    setScanning(false);
  }

  async function validar(textoQr: string) {
    setCargando(true);
    setError(null);
    try {
      // Extraer el token del texto del QR. Puede ser URL completa o solo
      // el token UUID. El endpoint valida estrictamente el formato.
      const match = textoQr.match(/\/socio\/([0-9a-fA-F-]{8,})\b/);
      const token = match ? match[1] : textoQr.trim();

      const res = await fetch(
        `/api/socios/validar?token=${encodeURIComponent(token)}`
      );
      const data = (await res.json()) as ResultadoValidacion;
      setResultado(data);
    } catch {
      setError("No se pudo validar el QR. Revisa tu conexión.");
    } finally {
      setCargando(false);
    }
  }

  function escanearOtro() {
    setResultado(null);
    setError(null);
  }

  return (
    <div className="space-y-4">
      {/* Boton principal grande, estado inicial */}
      {!scanning && !resultado && !cargando && (
        <button
          type="button"
          className="w-full h-[72px] rounded-2xl bg-brand-700 hover:bg-brand-900 text-white font-semibold shadow-sm transition-all flex items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          onClick={iniciarEscaneo}
        >
          <svg
            className="w-7 h-7"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-lg">Escanear QR</span>
        </button>
      )}

      {/* Visor con marco */}
      {scanning && (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden border border-slate-300 bg-black min-h-[320px]">
            <div
              id={containerId}
              className="w-full h-full min-h-[320px]"
            />
            {/* Marco animado como guia visual */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="relative w-[240px] h-[240px]">
                <span className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-white rounded-tl-lg" />
                <span className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-white rounded-tr-lg" />
                <span className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-white rounded-bl-lg" />
                <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-white rounded-br-lg" />
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 text-center">
            Centra el código QR dentro del marco.
          </p>
          <button
            type="button"
            className="w-full h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
            onClick={cancelarEscaneo}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Cargando */}
      {cargando && (
        <div className="rounded-2xl bg-white border border-slate-200 text-center text-sm text-slate-600 py-10 flex flex-col items-center gap-2">
          <svg
            className="animate-spin w-6 h-6 text-brand-700"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="3"
            />
            <path
              d="M22 12a10 10 0 0 1-10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          Validando…
        </div>
      )}

      {/* Resultado: activo */}
      {resultado?.estado === "activo" && (
        <div className="rounded-2xl border-2 border-green-500 bg-green-50 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-7 h-7 text-green-700"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-green-900 leading-tight">
                Socio activo
              </div>
              <div className="text-xs text-green-800">
                Período {resultado.periodo}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-green-200 space-y-3 text-sm text-slate-800">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                Familia
              </div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {resultado.apoderado}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                {resultado.hijos.length > 1 ? "Alumnos" : "Alumno"}
              </div>
              <ul className="mt-1 space-y-0.5">
                {resultado.hijos.map((h, i) => (
                  <li key={i}>
                    <span className="font-medium text-slate-900">
                      {h.nombre}
                    </span>
                    {h.curso && (
                      <span className="text-slate-500"> · {h.curso}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {resultado.pagadaEn && (
            <p className="text-[11px] text-green-800 pt-2 border-t border-green-200">
              Pago registrado el{" "}
              {new Date(resultado.pagadaEn).toLocaleDateString("es-CL")}
            </p>
          )}
        </div>
      )}

      {/* Resultado: no valido */}
      {resultado?.estado === "no_valido" && (
        <div className="rounded-2xl border-2 border-red-400 bg-red-50 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-7 h-7 text-red-700"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold text-red-900 leading-tight">
                QR no válido
              </div>
              <div className="text-xs text-red-800">
                No se puede acreditar la membresía
              </div>
            </div>
          </div>
          <p className="text-sm text-red-800 pt-2 border-t border-red-200">
            {resultado.motivo}
          </p>
        </div>
      )}

      {resultado && (
        <button
          type="button"
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          onClick={escanearOtro}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Escanear otro
        </button>
      )}

      {error && (
        <div
          role="alert"
          className="text-sm bg-red-50 text-red-800 rounded-xl p-3 border border-red-200"
        >
          {error}
        </div>
      )}
    </div>
  );
}
