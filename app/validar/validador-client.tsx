"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

type ResultadoValidacion =
  | {
      estado: "activo";
      apoderado: string;
      alumno: string;
      curso: string;
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
      // Extraer el token del texto del QR. Puede ser:
      //   - URL completa: https://.../socio/<token>
      //   - Solo el token (uuid)
      const match = textoQr.match(
        /\/socio\/([0-9a-fA-F-]{8,})\b/
      );
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
    <div className="space-y-3">
      {!scanning && !resultado && !cargando && (
        <button
          type="button"
          className="btn-primary w-full py-4 text-lg"
          onClick={iniciarEscaneo}
        >
          📷 Escanear QR
        </button>
      )}

      {scanning && (
        <div className="space-y-2">
          <div
            id={containerId}
            className="rounded-md overflow-hidden border border-slate-300 bg-black min-h-[280px]"
          />
          <p className="text-xs text-slate-500 text-center">
            Apunta la cámara al código QR del apoderado.
          </p>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={cancelarEscaneo}
          >
            Cancelar
          </button>
        </div>
      )}

      {cargando && (
        <div className="card text-center text-sm text-slate-600 py-8">
          Validando...
        </div>
      )}

      {resultado?.estado === "activo" && (
        <div className="card border-2 border-green-500 bg-green-50 text-center space-y-2">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-bold text-green-900">
            Socio activo {resultado.periodo}
          </div>
          <div className="pt-2 border-t border-green-200 space-y-1 text-sm text-slate-800">
            <div>
              <span className="text-xs uppercase text-slate-500">Familia</span>
              <div className="font-semibold">{resultado.apoderado}</div>
            </div>
            <div>
              <span className="text-xs uppercase text-slate-500">Alumno</span>
              <div>
                {resultado.alumno} · {resultado.curso}
              </div>
            </div>
          </div>
          {resultado.pagadaEn && (
            <p className="text-xs text-green-800 pt-2 border-t border-green-200">
              Pagada el{" "}
              {new Date(resultado.pagadaEn).toLocaleDateString("es-CL")}
            </p>
          )}
        </div>
      )}

      {resultado?.estado === "no_valido" && (
        <div className="card border-2 border-red-400 bg-red-50 text-center space-y-2">
          <div className="text-5xl">❌</div>
          <div className="text-lg font-bold text-red-900">QR no válido</div>
          <p className="text-sm text-red-800">{resultado.motivo}</p>
        </div>
      )}

      {resultado && (
        <button
          type="button"
          className="btn-primary w-full"
          onClick={escanearOtro}
        >
          📷 Escanear otro
        </button>
      )}

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
    </div>
  );
}
