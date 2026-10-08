"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OtpInput } from "@/app/incorporacion/otp-input";
import {
  solicitarOtpOperador,
  verificarOtpOperador,
  estadoPostOtpOperador,
  abrirSesionOperador,
  cambiarCorreoOperador,
  type ConvenioDisponible,
} from "./actions";

// Flujo:
//   email -> solicitarOtpOperador -> otp -> verificarOtpOperador
//                                              |
//                                              v
//                                     estadoPostOtpOperador
//                                     /          |         \
//                           ningun_convenio   listo(1)   listo(>1)
//                                   |           |           |
//                           mensaje final   abrir()     selector -> abrir()
//                                                           |
//                                                       redirect /validar

type Paso =
  | { nombre: "email" }
  | { nombre: "otp"; email: string }
  | { nombre: "selector"; convenios: ConvenioDisponible[] }
  | { nombre: "ningun_convenio" };

export function AccesoForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [paso, setPaso] = useState<Paso>({ nombre: "email" });
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [reenviarEnSeg, setReenviarEnSeg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Si al montar ya hay sesion operador activa, estadoPostOtpOperador
  // devuelve ya_autorizado y redirigimos. Si solo hay sesion OTP y el
  // correo tiene convenios, saltamos al selector/convenio directo.
  useEffect(() => {
    (async () => {
      try {
        const s = await estadoPostOtpOperador();
        if (s.estado === "ya_autorizado") {
          router.replace("/validar");
          return;
        }
        if (s.estado === "ningun_convenio_activo") {
          setPaso({ nombre: "ningun_convenio" });
          return;
        }
        if (s.estado === "listo") {
          aplicarListo(s.convenios);
        }
      } catch {
        // silencioso: nos quedamos en paso email.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reenviarEnSeg <= 0) return;
    const t = setInterval(() => setReenviarEnSeg((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [reenviarEnSeg]);

  function aplicarListo(convenios: ConvenioDisponible[]) {
    if (convenios.length === 1) {
      abrir(convenios[0].convenioOperadorId);
    } else {
      setPaso({ nombre: "selector", convenios });
    }
  }

  function enviarEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const r = await solicitarOtpOperador(email);
        if (!r.ok) {
          setError(
            "No pudimos enviar el código en este momento. Inténtalo nuevamente en unos minutos."
          );
          return;
        }
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
        const r = await solicitarOtpOperador(paso.email);
        if (!r.ok) {
          setError(
            "No pudimos enviar el código en este momento. Inténtalo nuevamente."
          );
          return;
        }
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
    cambiarCorreoOperador().catch(() => {});
  }

  function verificar(codigoActual: string) {
    if (paso.nombre !== "otp") return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const r = await verificarOtpOperador(paso.email, codigoActual);
        if (!r.ok) {
          if (r.motivo === "codigo_expirado") {
            setError("El código expiró. Solicita uno nuevo.");
          } else if (r.motivo === "max_intentos") {
            setError(
              "Demasiados intentos. Espera unos minutos y solicita un nuevo código."
            );
          } else if (r.motivo === "error_servicio") {
            setError(
              "No pudimos verificar el código en este momento. Inténtalo nuevamente."
            );
          } else {
            setError("Código incorrecto. Revisa los números e inténtalo nuevamente.");
          }
          setCodigo("");
          return;
        }
        const s = await estadoPostOtpOperador();
        if (s.estado === "ya_autorizado") {
          router.replace("/validar");
          return;
        }
        if (s.estado === "ningun_convenio_activo") {
          setPaso({ nombre: "ningun_convenio" });
          return;
        }
        if (s.estado === "listo") {
          aplicarListo(s.convenios);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function abrir(convenioOperadorId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await abrirSesionOperador(convenioOperadorId);
        if (!r.ok) {
          if (r.motivo === "sesion_otp_invalida") {
            setError("Tu verificación expiró. Vuelve a ingresar el código.");
            setPaso({ nombre: "email" });
          } else if (r.motivo === "convenio_no_autorizado") {
            setError("No puedes acceder como ese convenio.");
          } else {
            setError("No pudimos abrir la sesión. Inténtalo nuevamente.");
          }
          return;
        }
        router.replace("/validar");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  // === RENDER ===

  if (paso.nombre === "email") {
    return (
      <form onSubmit={enviarEmail} className="space-y-5" noValidate>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Correo autorizado por el convenio
          </label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@comercio.cl"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
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
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Enviando código…" : "Continuar"}
        </button>
      </form>
    );
  }

  if (paso.nombre === "otp") {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-slate-900">
            Verifica tu correo
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Enviamos un código de 6 dígitos. Puede tardar hasta un minuto en llegar.
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
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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

  if (paso.nombre === "selector") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Elige el convenio con el que validarás
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Tu correo está autorizado por {paso.convenios.length} convenios.
            Elige con cuál quieres iniciar la sesión del validador.
          </p>
        </div>
        <ul className="space-y-2">
          {paso.convenios.map((c) => (
            <li key={c.convenioOperadorId}>
              <button
                type="button"
                onClick={() => abrir(c.convenioOperadorId)}
                disabled={pending}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.logoUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="w-10 h-10 rounded object-contain bg-slate-100 flex-shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility =
                        "hidden";
                    }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-slate-100 flex-shrink-0" />
                )}
                <span className="font-medium text-sm text-slate-900 text-left truncate">
                  {c.nombre}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  // ningun_convenio
  return (
    <div className="space-y-4 text-center">
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5">
        <h3 className="text-lg font-semibold text-slate-900">
          No tienes convenios activos
        </h3>
        <p className="text-sm text-slate-700 mt-2">
          No tienes convenios activos disponibles para validar en este momento.
          Si crees que es un error, contacta a la directiva del Centro de Padres.
        </p>
      </div>
      <button
        type="button"
        onClick={cambiarCorreo}
        className="w-full h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
      >
        Usar otro correo
      </button>
    </div>
  );
}

function formatearSeg(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}
