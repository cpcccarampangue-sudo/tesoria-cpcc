"use client";

import { useEffect, useState, useTransition } from "react";
import type { SocioConfig } from "@/lib/types";
import { CURSO_GRUPOS, CURSO_LETRAS } from "@/lib/cursos";
import {
  solicitarOtp,
  verificarOtp,
  estadoPostOtp,
  cerrarSesionOtp,
  crearSolicitudSocio,
  crearSolicitudManualSocio,
  type EstadoPostOtp,
} from "./actions";
import { OtpInput } from "./otp-input";

// Flujo:
//   email  -> solicitarOtp  -> otp  -> verificarOtp
//                                         |
//                                         v
//                                     estadoPostOtp
//                                     /    |     \
//                               ya_socio  existente  nuevo
//                                   |         |        |
//                                  QR    confirmar  manual

type Paso =
  | { nombre: "email" }
  | { nombre: "otp"; email: string }
  | { nombre: "ya_socio"; qrToken: string }
  | {
      nombre: "confirmar_existente";
      email: string;
      apoderadoId: string;
      apoderadoNombre: string;
      estudiantes: Array<{ id: string; nombre: string; curso: string | null }>;
    }
  | { nombre: "manual"; email: string };

function esRedirect(err: unknown): boolean {
  return (
    err instanceof Error &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function IncorporacionForm({ config }: { config: SocioConfig }) {
  const [pending, startTransition] = useTransition();
  const [paso, setPaso] = useState<Paso>({ nombre: "email" });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Email
  const [email, setEmail] = useState("");

  // OTP
  const [codigo, setCodigo] = useState("");
  const [reenviarEnSeg, setReenviarEnSeg] = useState(0);

  // Confirmar existente (caso B)
  const [telefono, setTelefono] = useState("");

  // Flujo manual (caso C)
  const [manual, setManual] = useState({
    apoderado_nombre: "",
    apoderado_telefono: "",
    apoderado_rut: "",
  });
  const [hijos, setHijos] = useState<Array<{ nombre: string; curso: string }>>([
    { nombre: "", curso: "" },
  ]);

  // Al montar la pagina, si ya hay sesion OTP activa saltamos al paso
  // correspondiente. Esto cubre el caso "refresque la pagina sin
  // querer" y evita obligar al usuario a verificar de nuevo.
  useEffect(() => {
    (async () => {
      try {
        const s = await estadoPostOtp();
        aplicarEstado(s);
      } catch {
        // Silencioso: si falla, seguimos en paso email.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer para habilitar reenviar.
  useEffect(() => {
    if (reenviarEnSeg <= 0) return;
    const t = setInterval(() => {
      setReenviarEnSeg((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [reenviarEnSeg]);

  function aplicarEstado(s: EstadoPostOtp) {
    if (s.caso === "sin_sesion") return;
    if (s.caso === "ya_socio") {
      setPaso({ nombre: "ya_socio", qrToken: s.qrToken });
      return;
    }
    if (s.caso === "familia_existente") {
      setPaso({
        nombre: "confirmar_existente",
        email: s.email,
        apoderadoId: s.apoderadoId,
        apoderadoNombre: s.apoderadoNombre,
        estudiantes: s.estudiantes,
      });
      return;
    }
    if (s.caso === "nuevo") {
      setPaso({ nombre: "nuevo" as never, email: s.email });
      setManual((m) => ({ ...m, apoderado_nombre: "" }));
      setHijos([{ nombre: "", curso: "" }]);
      setPaso({ nombre: "manual", email: s.email });
    }
  }

  function enviarEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const r = await solicitarOtp(email);
        setPaso({ nombre: "otp", email });
        setCodigo("");
        setReenviarEnSeg(r.reintentarEnSeg ?? 60);
        setInfo(
          "Te enviamos un código de verificación. Puede tardar hasta un minuto en llegar."
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function reenviar() {
    if (paso.nombre !== "otp" || reenviarEnSeg > 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await solicitarOtp(paso.email);
        setCodigo("");
        setReenviarEnSeg(r.reintentarEnSeg ?? 60);
        setInfo("Enviamos un código nuevo.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function cambiarCorreo() {
    setPaso({ nombre: "email" });
    setCodigo("");
    setError(null);
    setInfo(null);
    setReenviarEnSeg(0);
    // Cerrar cualquier sesion OTP previa.
    cerrarSesionOtp().catch(() => {});
  }

  function verificar(codigoActual: string) {
    if (paso.nombre !== "otp") return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const r = await verificarOtp(paso.email, codigoActual);
        if (!r.ok) {
          if (r.motivo === "codigo_expirado") {
            setError("El código expiró. Solicita uno nuevo.");
          } else if (r.motivo === "max_intentos") {
            setError(
              "Demasiados intentos. Espera unos minutos y solicita un nuevo código."
            );
          } else {
            setError("Código incorrecto. Revisa los números e inténtalo nuevamente.");
          }
          setCodigo("");
          return;
        }
        // Verificado: traer estado post-OTP.
        const s = await estadoPostOtp();
        aplicarEstado(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function confirmarExistente(e: React.FormEvent) {
    e.preventDefault();
    if (paso.nombre !== "confirmar_existente") return;
    setError(null);
    const todosLosHijosIds = paso.estudiantes.map((e) => e.id);
    const emailActual = paso.email;
    startTransition(async () => {
      try {
        await crearSolicitudSocio({
          apoderado_id: paso.apoderadoId,
          apoderado_email: emailActual,
          apoderado_telefono: telefono,
          estudiante_ids: todosLosHijosIds,
        });
      } catch (err) {
        if (esRedirect(err)) return;
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function enviarManual(e: React.FormEvent) {
    e.preventDefault();
    if (paso.nombre !== "manual") return;
    setError(null);
    const emailActual = paso.email;
    startTransition(async () => {
      try {
        await crearSolicitudManualSocio({
          apoderado_nombre: manual.apoderado_nombre,
          apoderado_email: emailActual,
          apoderado_rut: manual.apoderado_rut,
          apoderado_telefono: manual.apoderado_telefono,
          hijos,
        });
      } catch (err) {
        if (esRedirect(err)) return;
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function actualizarHijo(
    i: number,
    patch: Partial<{ nombre: string; curso: string }>
  ) {
    setHijos((cur) => cur.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }
  function agregarHijo() {
    setHijos((cur) => [...cur, { nombre: "", curso: "" }]);
  }
  function quitarHijo(i: number) {
    setHijos((cur) => (cur.length <= 1 ? cur : cur.filter((_, idx) => idx !== i)));
  }

  // =========== RENDER ===========

  if (paso.nombre === "email") {
    return (
      <form onSubmit={enviarEmail} className="space-y-5" noValidate>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Correo electrónico
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.cl"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Por privacidad, solo puedes continuar utilizando el correo
            registrado en matrícula.
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

        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
        >
          {pending ? "Enviando código…" : "Continuar"}
        </button>
      </form>
    );
  }

  if (paso.nombre === "otp") {
    const emailMostrado = enmascararEmailParaDisplay(paso.email);
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mb-3">
            <svg
              className="w-6 h-6 text-brand-700"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-900">
            Verifica tu correo
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Enviamos un código de 6 dígitos a:
          </p>
          <p className="text-sm font-mono text-slate-900 mt-0.5">
            {emailMostrado}
          </p>
        </div>

        <OtpInput
          value={codigo}
          onChange={setCodigo}
          onComplete={verificar}
          disabled={pending}
          autoFocus
        />

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}
        {!error && info && (
          <div className="text-sm bg-slate-50 text-slate-700 rounded-lg p-3 border border-slate-200">
            {info}
          </div>
        )}

        <button
          type="button"
          onClick={() => verificar(codigo)}
          disabled={pending || codigo.length !== 6}
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
        >
          {pending ? "Verificando…" : "Verificar código"}
        </button>

        <div className="text-center text-xs text-slate-500 space-y-2">
          <div>¿No recibiste el código?</div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reenviar}
              disabled={pending || reenviarEnSeg > 0}
              className="text-sm font-medium text-brand-700 hover:text-brand-900 disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              {reenviarEnSeg > 0
                ? `Reenviar código en ${formatearSeg(reenviarEnSeg)}`
                : "Reenviar código"}
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={cambiarCorreo}
              disabled={pending}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Cambiar correo
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (paso.nombre === "ya_socio") {
    const origen =
      typeof window !== "undefined" ? window.location.origin : "";
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-green-50 border border-green-200 p-5 space-y-3">
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
              <div className="text-[11px] font-semibold uppercase tracking-wider text-green-800">
                Socio vigente
              </div>
              <div className="text-lg font-semibold text-slate-900 leading-tight">
                Ya figuras como socio activo
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-700 pt-2 border-t border-green-200">
            Tu familia tiene su cuota al día para el período vigente. No
            necesitas pagar de nuevo.
          </p>
        </div>

        <a
          href={`${origen}/socio/${paso.qrToken}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-colors flex items-center justify-center"
        >
          Ver mi QR de socio
        </a>

        <button
          type="button"
          onClick={cambiarCorreo}
          className="w-full h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  if (paso.nombre === "confirmar_existente") {
    const totalHijos = paso.estudiantes.length;
    return (
      <form onSubmit={confirmarExistente} className="space-y-4">
        <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-900">
          <strong>Encontramos tu familia.</strong> Revisa la información y
          continúa con tu incorporación como socio {config.periodo_anio}.
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Familia
          </label>
          <div className="w-full h-[52px] px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 flex items-center">
            {paso.apoderadoNombre}
          </div>
        </div>

        {totalHijos === 0 ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            No encontramos alumnos activos vinculados a tu familia.
            Contacta a la tesorería para completar los datos antes de
            incorporarte como socio.
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Hijos cubiertos por este QR
            </label>
            <p className="text-xs text-slate-500 mb-2">
              La cuota es por familia; el QR cubre a todos tus hijos
              matriculados.
            </p>
            <ul className="space-y-1.5">
              {paso.estudiantes.map((est) => (
                <li
                  key={est.id}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50"
                >
                  <div className="font-medium text-sm text-slate-900">
                    {est.nombre}
                  </div>
                  <div className="text-xs text-slate-500">
                    {est.curso ?? "— sin curso —"}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Correo verificado
          </label>
          <div className="flex items-center h-[52px] px-4 rounded-xl border border-green-200 bg-green-50 text-sm text-slate-800 gap-2">
            <svg
              className="w-4 h-4 text-green-700 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="truncate">{paso.email}</span>
          </div>
        </div>

        <div>
          <label
            htmlFor="tel-existente"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Teléfono{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            id="tel-existente"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+56 9 1234 5678"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
        </div>

        <div className="rounded-xl bg-brand-50 border border-brand-200 p-4">
          <div className="text-xs text-slate-600 uppercase tracking-wider font-medium">
            Monto a pagar
          </div>
          <div className="text-2xl font-semibold text-brand-900 mt-0.5">
            ${config.monto_cuota.toLocaleString("es-CL")} CLP
          </div>
          <div className="text-xs text-slate-600 mt-1">
            Cuota socio {config.periodo_anio}
            {totalHijos > 0 && (
              <>
                {" "}· cubre {totalHijos} hijo{totalHijos !== 1 ? "s" : ""}
              </>
            )}
            .
          </div>
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
            className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
            onClick={cambiarCorreo}
          >
            Cambiar correo
          </button>
          <button
            type="submit"
            disabled={pending || totalHijos === 0}
            className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          >
            {pending ? "Procesando…" : "Continuar incorporación"}
          </button>
        </div>
      </form>
    );
  }

  // paso.nombre === "manual"  (caso C)
  return (
    <form onSubmit={enviarManual} className="space-y-4">
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
        <strong>Nueva incorporación.</strong> No encontramos una familia
        asociada a este correo. Completa tus datos para incorporarte al
        Centro de Padres.
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Correo verificado
        </label>
        <div className="flex items-center h-[52px] px-4 rounded-xl border border-green-200 bg-green-50 text-sm text-slate-800 gap-2">
          <svg
            className="w-4 h-4 text-green-700 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span className="truncate">{paso.email}</span>
        </div>
      </div>

      <div>
        <label
          htmlFor="m-nombre"
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          Nombre del apoderado
        </label>
        <input
          id="m-nombre"
          className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          value={manual.apoderado_nombre}
          onChange={(e) =>
            setManual((m) => ({ ...m, apoderado_nombre: e.target.value }))
          }
          placeholder="Ej: María Pérez González"
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="m-rut"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            RUT{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            id="m-rut"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={manual.apoderado_rut}
            onChange={(e) =>
              setManual((m) => ({ ...m, apoderado_rut: e.target.value }))
            }
            placeholder="12.345.678-9"
          />
        </div>
        <div>
          <label
            htmlFor="m-tel"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Teléfono{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            id="m-tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={manual.apoderado_telefono}
            onChange={(e) =>
              setManual((m) => ({ ...m, apoderado_telefono: e.target.value }))
            }
            placeholder="+56 9 1234 5678"
          />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 mt-5">
        <h3 className="font-medium text-slate-800">Datos de los alumnos</h3>
        <p className="text-xs text-slate-500 mb-3 mt-1">
          Puedes agregar varios hijos. Nos ayuda a identificar correctamente
          tu familia.
        </p>
        <div className="space-y-2.5">
          {hijos.map((h, i) => (
            <div
              key={i}
              className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/60"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  Hijo {i + 1}
                </span>
                {hijos.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => quitarHijo(i)}
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nombre del alumno
                  </label>
                  <input
                    className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 shadow-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    value={h.nombre}
                    onChange={(e) =>
                      actualizarHijo(i, { nombre: e.target.value })
                    }
                    placeholder="Ej: Juan Pérez"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Curso
                  </label>
                  <select
                    className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 shadow-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    value={h.curso}
                    onChange={(e) =>
                      actualizarHijo(i, { curso: e.target.value })
                    }
                    required
                  >
                    <option value="">— seleccionar —</option>
                    {CURSO_GRUPOS.map((grupo) => (
                      <optgroup key={grupo.nombre} label={grupo.nombre}>
                        {grupo.niveles.flatMap((nivel) =>
                          CURSO_LETRAS.map((letra) => (
                            <option
                              key={`${nivel}-${letra}`}
                              value={`${nivel} ${letra}`}
                            >
                              {nivel} {letra}
                            </option>
                          ))
                        )}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="text-sm text-brand-700 hover:underline mt-2.5"
          onClick={agregarHijo}
        >
          + Agregar otro hijo
        </button>
      </div>

      <div className="rounded-xl bg-brand-50 border border-brand-200 p-4">
        <div className="text-xs text-slate-600 uppercase tracking-wider font-medium">
          Monto a pagar
        </div>
        <div className="text-2xl font-semibold text-brand-900 mt-0.5">
          ${config.monto_cuota.toLocaleString("es-CL")} CLP
        </div>
        <div className="text-xs text-slate-600 mt-1">
          Cuota socio {config.periodo_anio}
        </div>
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
          className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          onClick={cambiarCorreo}
        >
          Cambiar correo
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
        >
          {pending ? "Procesando…" : "Continuar al pago"}
        </button>
      </div>

      <p className="text-xs text-slate-500 text-center leading-relaxed">
        Tu solicitud quedará como <strong>pendiente de identificar</strong>.
        La tesorería verificará tus datos antes de confirmar la membresía.
      </p>
    </form>
  );
}

// Enmascara un email para mostrar al usuario mientras verifica el OTP.
// Patron: p••••••@g••••.com — primera letra visible + bullets.
function enmascararEmailParaDisplay(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "•••@•••";
  const local = email.slice(0, at);
  const dom = email.slice(at + 1);
  const dot = dom.indexOf(".");
  const dom1 = dot > 0 ? dom.slice(0, dot) : dom;
  const dom2 = dot > 0 ? dom.slice(dot) : "";
  const localMask =
    local.length <= 2
      ? local[0] + "•"
      : local[0] + "•".repeat(Math.min(6, local.length - 1));
  const dom1Mask =
    dom1.length <= 2
      ? dom1[0] + "•"
      : dom1[0] + "•".repeat(Math.min(4, dom1.length - 1));
  return `${localMask}@${dom1Mask}${dom2}`;
}

function formatearSeg(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}
