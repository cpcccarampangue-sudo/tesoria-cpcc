"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200 mb-2">
        <button
          type="button"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === "signin"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => {
            setMode("signin");
            setMessage(null);
          }}
        >
          Ingresar
        </button>
        <button
          type="button"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === "signup"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => {
            setMode("signup");
            setMessage(null);
          }}
        >
          Crear cuenta
        </button>
      </div>
      <div>
        <label htmlFor="email" className="label">
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.cl"
        />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={mode === "signup" ? 8 : undefined}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Mínimo 8 caracteres" : ""}
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading
          ? "Un momento..."
          : mode === "signin"
          ? "Ingresar"
          : "Crear cuenta"}
      </button>
      {message && (
        <div
          className={
            message.type === "ok"
              ? "text-sm bg-green-50 text-green-800 rounded-md p-3"
              : "text-sm bg-red-50 text-red-800 rounded-md p-3"
          }
        >
          {message.text}
        </div>
      )}
    </form>
  );
}
