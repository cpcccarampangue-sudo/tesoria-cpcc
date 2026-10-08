"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import {
  buscarFamiliaPorApellido,
  confirmarIdentidadYValidar,
  type FamiliaResumen,
} from "./actions";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResultadoValido = {
  valid: true;
  displayName: string;
  status: "Activo";
  category: "Apoderado";
  validUntil: string;
  periodo: number;
};
type ResultadoInvalido = {
  valid: false;
  motivo: string;
  // Si el QR es conocido pero sin membresia vigente, el server marca
  // estado='membresia_no_vigente' y envia displayName + periodo. Se
  // renderiza como warning (amber) en vez de error (red).
  estado?: "membresia_no_vigente" | "qr_invalido";
  displayName?: string;
  periodo?: number;
};
type Resultado = ResultadoValido | ResultadoInvalido;

type Modo =
  | "inicial"
  | "camara"
  | "manual"
  | "apellido_buscar"
  | "apellido_elegir"
  | "apellido_confirmar";

export function ValidadorClient() {
  const [modo, setModo] = useState<Modo>("inicial");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [codigoManual, setCodigoManual] = useState("");

  // Estados del flujo apellido
  const [apellidoQuery, setApellidoQuery] = useState("");
  const [resultadosApellido, setResultadosApellido] = useState<FamiliaResumen[]>(
    []
  );
  const [hayMasApellido, setHayMasApellido] = useState(false);
  const [familiaElegida, setFamiliaElegida] = useState<FamiliaResumen | null>(
    null
  );
  const [pin, setPin] = useState("");

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "qr-reader-container";

  useEffect(() => {
    return () => {
      scannerRef.current?.stop().catch(() => {});
      scannerRef.current?.clear();
      scannerRef.current = null;
    };
  }, []);

  // === Cámara ===
  async function iniciarCamara() {
    setError(null);
    setResultado(null);
    setModo("camara");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          await scanner.stop().catch(() => {});
          await validarPorToken(decodedText);
        },
        () => {}
      );
    } catch (err) {
      setModo("inicial");
      setError(
        err instanceof Error && err.message
          ? "No se pudo acceder a la cámara. Autoriza el permiso o usa el ingreso manual."
          : "Cámara no disponible. Usa el ingreso manual."
      );
    }
  }

  async function cancelarCamara() {
    await scannerRef.current?.stop().catch(() => {});
    setModo("inicial");
  }

  // === Ingreso manual (código) ===
  function abrirManual() {
    setError(null);
    setResultado(null);
    setCodigoManual("");
    setModo("manual");
  }

  async function enviarManual(e: React.FormEvent) {
    e.preventDefault();
    await validarPorToken(codigoManual);
  }

  async function validarPorToken(textoQr: string) {
    setCargando(true);
    setError(null);
    try {
      const match = textoQr.match(/\/socio\/([0-9a-fA-F-]{8,})\b/);
      const token = (match ? match[1] : textoQr).trim();

      if (!UUID_V4_RE.test(token)) {
        setResultado({
          valid: false,
          motivo:
            "El código no tiene el formato esperado. Verifica que estés escaneando un QR del Centro de Padres.",
        });
        setModo("inicial");
        return;
      }

      const res = await fetch(
        `/api/socios/validar?token=${encodeURIComponent(token)}`
      );
      const data = (await res.json()) as Resultado;
      setResultado(data);
      setModo("inicial");
    } catch {
      setError("No se pudo validar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  // === Buscar por apellido ===
  function abrirBuscarApellido() {
    setError(null);
    setResultado(null);
    setApellidoQuery("");
    setResultadosApellido([]);
    setHayMasApellido(false);
    setFamiliaElegida(null);
    setPin("");
    setModo("apellido_buscar");
  }

  async function buscarApellido(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const r = await buscarFamiliaPorApellido(apellidoQuery);
      setResultadosApellido(r.familias);
      setHayMasApellido(r.hayMas);
      setModo("apellido_elegir");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error.");
    } finally {
      setCargando(false);
    }
  }

  function elegirFamilia(f: FamiliaResumen) {
    setFamiliaElegida(f);
    setPin("");
    setError(null);
    setModo("apellido_confirmar");
  }

  async function enviarPin(e: React.FormEvent) {
    e.preventDefault();
    if (!familiaElegida) return;
    setError(null);
    setCargando(true);
    try {
      const r = await confirmarIdentidadYValidar(
        familiaElegida.apoderadoId,
        pin
      );
      if (!r.ok) {
        if (r.motivo === "digitos_invalidos") {
          setError("Ingresa 4 dígitos.");
        } else {
          setError(
            "Esta familia no tiene un dato de confirmación registrado. Pide el QR al socio o contacta a la directiva."
          );
        }
        return;
      }
      if (r.valid) {
        setResultado({
          valid: true,
          displayName: r.displayName!,
          status: r.status!,
          category: r.category!,
          validUntil: r.validUntil!,
          periodo: r.periodo!,
        });
      } else {
        // Si el server distingue "membresia_no_vigente" (CASO B), lo
        // propagamos a la UI para render ambar. En caso contrario
        // (pin_mismatch u otro) mostramos mensaje generico (rojo).
        if (r.estado === "membresia_no_vigente") {
          setResultado({
            valid: false,
            estado: "membresia_no_vigente",
            displayName: r.displayName,
            periodo: r.periodo,
            motivo: `Membresía no vigente${r.periodo ? ` para el período ${r.periodo}` : ""}.`,
          });
        } else {
          setResultado({
            valid: false,
            motivo:
              "La credencial no se encuentra registrada o no está vigente.",
          });
        }
      }
      setModo("inicial");
      setPin("");
      setFamiliaElegida(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error.");
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setError(null);
    setModo("inicial");
    setCodigoManual("");
    setApellidoQuery("");
    setResultadosApellido([]);
    setFamiliaElegida(null);
    setPin("");
  }

  // === RENDER ===

  // Vista cámara
  if (modo === "camara") {
    return (
      <div className="space-y-3">
        <div className="relative rounded-2xl overflow-hidden border border-slate-300 bg-black min-h-[320px]">
          <div id={containerId} className="w-full h-full min-h-[320px]" />
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
          className="w-full h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          onClick={cancelarCamara}
        >
          Cancelar
        </button>
      </div>
    );
  }

  // Vista manual (input de código)
  if (modo === "manual" && !resultado) {
    return (
      <form onSubmit={enviarManual} className="space-y-4">
        <div>
          <label
            htmlFor="codigo-manual"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Código de la credencial
          </label>
          <input
            id="codigo-manual"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            required
            value={codigoManual}
            onChange={(e) => setCodigoManual(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 font-mono tracking-wide"
          />
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Pega el código impreso en el QR o el enlace completo
            (https://.../socio/...).
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={reiniciar}
            className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={cargando || !codigoManual.trim()}
            className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          >
            {cargando ? "Validando…" : "Validar credencial"}
          </button>
        </div>
      </form>
    );
  }

  // Vista buscar por apellido - paso 1 (input)
  if (modo === "apellido_buscar") {
    return (
      <form onSubmit={buscarApellido} className="space-y-4">
        <div>
          <label
            htmlFor="apellido"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Apellido de la familia
          </label>
          <input
            id="apellido"
            type="text"
            inputMode="text"
            autoCapitalize="words"
            autoComplete="off"
            spellCheck={false}
            required
            value={apellidoQuery}
            onChange={(e) => setApellidoQuery(e.target.value)}
            placeholder="Ej: González"
            minLength={3}
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Mínimo 3 caracteres. Luego pediremos un dato adicional para
            confirmar la identidad.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={reiniciar}
            className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={cargando || apellidoQuery.trim().length < 3}
            className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          >
            {cargando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </form>
    );
  }

  // Vista buscar por apellido - paso 2 (elegir familia)
  if (modo === "apellido_elegir") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
          Mostramos los apellidos coincidentes de forma parcial. Elige la
          familia que corresponde a quien está contigo.
        </div>

        {resultadosApellido.length === 0 ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
            No encontramos familias con ese apellido. Verifica el escrito o
            pide el QR al socio.
          </div>
        ) : (
          <ul className="space-y-2">
            {resultadosApellido.map((f) => (
              <li key={f.apoderadoId}>
                <button
                  type="button"
                  onClick={() => elegirFamilia(f)}
                  className="w-full text-left p-3.5 border border-slate-200 rounded-xl hover:border-brand-500 hover:bg-brand-50 transition-colors flex items-center justify-between gap-3"
                >
                  <span className="font-medium text-slate-900 truncate">
                    {f.nombreMask}
                  </span>
                  {!f.puedeConfirmar && (
                    <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex-shrink-0">
                      sin dato
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {hayMasApellido && (
          <div className="text-xs text-amber-700">
            Hay más coincidencias. Afina el apellido si no reconoces la
            familia.
          </div>
        )}

        <button
          type="button"
          onClick={() => setModo("apellido_buscar")}
          className="w-full h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
        >
          Volver a buscar
        </button>
      </div>
    );
  }

  // Vista buscar por apellido - paso 3 (pedir PIN)
  if (modo === "apellido_confirmar" && familiaElegida) {
    return (
      <form onSubmit={enviarPin} className="space-y-4">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
            Familia
          </div>
          <div className="font-medium text-slate-900 mt-0.5">
            {familiaElegida.nombreMask}
          </div>
        </div>

        <div>
          <label
            htmlFor="pin"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Últimos 4 dígitos del teléfono registrado
          </label>
          <input
            id="pin"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={4}
            required
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="••••"
            className="w-full h-[56px] px-4 rounded-xl border border-slate-300 bg-white text-xl text-slate-900 placeholder:text-slate-400 shadow-sm font-mono tracking-widest text-center focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Pide al socio los últimos 4 dígitos de su teléfono. No se los
            mostramos.
          </p>
        </div>

        {!familiaElegida.puedeConfirmar && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            Esta familia no tiene teléfono registrado. No podrás validar
            desde este formulario — pide el QR al socio o escribe a la
            directiva.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setModo("apellido_elegir")}
            className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={
              cargando || pin.length !== 4 || !familiaElegida.puedeConfirmar
            }
            className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          >
            {cargando ? "Confirmando…" : "Confirmar identidad"}
          </button>
        </div>
      </form>
    );
  }

  // Resultado o estado inicial
  return (
    <div className="space-y-4">
      {!resultado && !cargando && (
        <>
          <button
            type="button"
            className="w-full h-[72px] rounded-2xl bg-brand-700 hover:bg-brand-900 text-white font-semibold shadow-sm transition-all flex items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
            onClick={iniciarCamara}
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
            <span className="text-lg">Escanear código QR</span>
          </button>

          <div className="relative py-1">
            <div
              className="absolute inset-x-0 top-1/2 h-px bg-slate-200"
              aria-hidden="true"
            />
            <span className="relative mx-auto block w-max bg-white px-3 text-xs uppercase tracking-widest text-slate-400">
              o
            </span>
          </div>

          <button
            type="button"
            className="w-full h-[52px] rounded-xl bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors"
            onClick={abrirManual}
          >
            Ingresar código manualmente
          </button>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-2 leading-relaxed">
              <strong className="text-slate-700">¿El socio no tiene su QR?</strong>{" "}
              Puedes buscarlo por apellido y confirmar su identidad antes
              de validar la membresía.
            </p>
            <button
              type="button"
              className="w-full h-[48px] rounded-xl bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors"
              onClick={abrirBuscarApellido}
            >
              Buscar por apellido
            </button>
          </div>
        </>
      )}

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
          Validando credencial…
        </div>
      )}

      {/* Credencial válida */}
      {resultado?.valid === true && (
        <div className="rounded-2xl border border-green-200 bg-green-50 overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center gap-3">
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
              <div className="text-[11px] font-semibold uppercase tracking-wider text-green-800">
                Socio vigente
              </div>
              <div className="text-xl font-semibold text-slate-900 leading-tight truncate">
                {resultado.displayName}
              </div>
            </div>
            <span className="ml-auto inline-flex items-center h-6 px-2 rounded-full bg-white border border-green-300 text-[11px] font-semibold text-green-800">
              Año {resultado.periodo}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-4 px-5 pb-5 pt-3 border-t border-green-200">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                Estado
              </dt>
              <dd className="text-sm font-semibold text-slate-900 mt-0.5">
                {resultado.status}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                Vigencia
              </dt>
              <dd className="text-sm font-semibold text-slate-900 mt-0.5">
                {resultado.validUntil}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                Categoría
              </dt>
              <dd className="text-sm font-semibold text-slate-900 mt-0.5">
                {resultado.category}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* CASO B: membresía no vigente — advertencia (ambar) */}
      {resultado?.valid === false &&
        resultado.estado === "membresia_no_vigente" && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 overflow-hidden">
            <div className="px-5 py-5 flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-7 h-7 text-amber-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                  Membresía no vigente
                </div>
                {resultado.displayName && (
                  <div className="text-lg font-semibold text-slate-900 leading-tight mt-0.5 truncate">
                    {resultado.displayName}
                  </div>
                )}
                <p className="text-sm text-slate-700 mt-2">
                  Esta familia está registrada, pero aún no ha renovado su
                  membresía
                  {resultado.periodo ? ` para el período ${resultado.periodo}` : ""}.
                </p>
              </div>
            </div>
          </div>
        )}

      {/* CASO C: QR inválido / credencial no reconocida — error (rojo) */}
      {resultado?.valid === false &&
        resultado.estado !== "membresia_no_vigente" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
            <div className="px-5 py-5 flex items-start gap-3">
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
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-red-800">
                  Credencial no válida
                </div>
                <div className="text-lg font-semibold text-slate-900 leading-tight mt-0.5">
                  QR inválido
                </div>
                <p className="text-sm text-slate-700 mt-2">
                  {resultado.motivo}
                </p>
              </div>
            </div>
          </div>
        )}

      {resultado && (
        <button
          type="button"
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          onClick={reiniciar}
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
          Validar otra credencial
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
