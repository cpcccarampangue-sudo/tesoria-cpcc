"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
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
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${siteUrl}/auth/callback`,
        },
      });
      if (error) throw error;
      setMessage({
        type: "ok",
        text: "Revisa tu correo. Te enviamos un enlace para ingresar (puede tardar 1-2 minutos y llegar a la carpeta de spam).",
      });
      setEmail("");
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Error al enviar el enlace.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Enviando..." : "Enviar enlace mágico"}
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
