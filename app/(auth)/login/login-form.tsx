"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<
    { type: "ok" | "err"; text: string } | null
  >(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const emailNorm = email.trim().toLowerCase();
      const pwd = password.trim();

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailNorm,
          password: pwd,
        });
        if (error) throw error;
        // Recarga completa para que el servidor lea las cookies nuevas
        window.location.href = "/dashboard";
      } else {
        if (pwd.length < 8) {
          throw new Error("La contraseña debe tener al menos 8 caracteres.");
        }
        const { data, error } = await supabase.auth.signUp({
          email: emailNorm,
          password: pwd,
        });
        if (error) throw error;
        if (data.session) {
          window.location.href = "/dashboard";
        } else {
          setMessage({
            type: "ok",
            text: "Cuenta creada. Ahora ingresa con tu correo y contraseña.",
          });
          setMode("signin");
        }
      }
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Error inesperado.",
      });
    } finally {
      setLoading(false);
    }
  }

  function cambiarModo(nuevo: "signin" | "signup") {
    if (nuevo === mode) return;
    setMode(nuevo);
    setMessage(null);
  }

  // Al cambiar entre modos, el título y subtítulo del padre no se refrescan
  // automáticamente (viven en page.tsx). Para no romper esa estructura,
  // actualizamos el DOM directamente aquí cuando corresponda. Es una
  // optimización de UX: el formulario sigue siendo auto-contenido.
  function syncHeader(nuevoMode: "signin" | "signup") {
    if (typeof document === "undefined") return;
    const titulo = document.getElementById("login-title");
    const subtitulo = document.getElementById("login-subtitle");
    if (titulo) {
      titulo.textContent =
        nuevoMode === "signin" ? "Bienvenido" : "Crea tu cuenta";
    }
    if (subtitulo) {
      subtitulo.textContent =
        nuevoMode === "signin"
          ? "Ingresa a tu cuenta para continuar."
          : "Regístrate con tu correo electrónico para acceder a Tesorería CPCC.";
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Segmented control moderno */}
      <div
        role="tablist"
        aria-label="Modo de acceso"
        className="relative inline-flex w-full p-1 rounded-xl bg-slate-100 border border-slate-200"
      >
        {/* Indicador animado del tab activo */}
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm transition-transform duration-200 ease-out"
          style={{
            transform:
              mode === "signin" ? "translateX(0)" : "translateX(100%)",
            left: "4px",
          }}
        />
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === "signin" ? "text-brand-700" : "text-slate-600 hover:text-slate-800"
          }`}
          onClick={() => {
            cambiarModo("signin");
            syncHeader("signin");
          }}
        >
          Ingresar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === "signup" ? "text-brand-700" : "text-slate-600 hover:text-slate-800"
          }`}
          onClick={() => {
            cambiarModo("signup");
            syncHeader("signup");
          }}
        >
          Crear cuenta
        </button>
      </div>

      {/* Email */}
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
          required
          autoComplete="email"
          className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.cl"
        />
      </div>

      {/* Password con toggle de visibilidad */}
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            minLength={mode === "signup" ? 8 : undefined}
            className="w-full h-[52px] pl-4 pr-12 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Mínimo 8 caracteres" : ""}
          />
          <button
            type="button"
            tabIndex={0}
            onClick={() => setShowPassword((v) => !v)}
            aria-label={
              showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
            }
            className="absolute inset-y-0 right-0 flex items-center justify-center w-11 text-slate-400 hover:text-slate-600 rounded-r-xl transition-colors focus:outline-none focus:text-brand-600"
          >
            {showPassword ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Botón principal */}
      <button
        type="submit"
        className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 active:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
        disabled={loading}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="animate-spin w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="3"
              />
              <path
                d="M22 12a10 10 0 0 1-10 10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            Un momento...
          </span>
        ) : mode === "signin" ? (
          "Ingresar"
        ) : (
          "Crear cuenta"
        )}
      </button>

      {/* Mensaje (ok o error) */}
      {message && (
        <div
          role={message.type === "err" ? "alert" : "status"}
          className={
            message.type === "ok"
              ? "text-sm bg-green-50 text-green-800 rounded-lg p-3 border border-green-200"
              : "text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          }
        >
          {message.text}
        </div>
      )}
    </form>
  );
}
