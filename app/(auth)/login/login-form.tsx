"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<
    { type: "ok" | "err"; text: string } | null
  >(null);

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
      });
      if (error) throw error;
      setStep("code");
      setMessage({
        type: "ok",
        text: "Te enviamos un código de 6 dígitos a tu correo. Puede tardar 1-2 minutos y llegar a la carpeta de spam.",
      });
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Error al enviar el código.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text:
          err instanceof Error
            ? err.message
            : "Código inválido o expirado. Solicita uno nuevo.",
      });
    } finally {
      setLoading(false);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={verifyCode} className="space-y-4">
        <p className="text-sm text-slate-600">
          Escribimos a <strong>{email}</strong>. Ingresa el código de 6 dígitos
          que llegó a tu correo.
        </p>
        <div>
          <label htmlFor="code" className="label">
            Código
          </label>
          <input
            id="code"
            type="text"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            className="input text-center text-2xl tracking-widest font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
          />
        </div>
        <button
          type="submit"
          className="btn-primary w-full"
          disabled={loading || code.length !== 6}
        >
          {loading ? "Verificando..." : "Entrar"}
        </button>
        <button
          type="button"
          className="text-sm text-slate-600 hover:underline w-full text-center"
          onClick={() => {
            setStep("email");
            setCode("");
            setMessage(null);
          }}
        >
          ← Cambiar correo o reenviar código
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

  return (
    <form onSubmit={sendCode} className="space-y-4">
      <div>
        <label htmlFor="email" className="label">
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.cl"
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Enviando..." : "Enviar código"}
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
