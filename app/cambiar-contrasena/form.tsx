"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarContrasenaTemporal } from "./actions";

export function CambiarContrasenaForm() {
  const router = useRouter();
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (nueva !== confirmacion) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    startTransition(async () => {
      try {
        await cambiarContrasenaTemporal(nueva);
        router.push("/dashboard");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label">Nueva contraseña</label>
        <input
          className="input"
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          minLength={8}
          required
          autoFocus
        />
        <div className="text-xs text-slate-500 mt-1">
          Mínimo 8 caracteres. Usa algo que recuerdes fácil.
        </div>
      </div>
      <div>
        <label className="label">Repite la contraseña</label>
        <input
          className="input"
          type="password"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          minLength={8}
          required
        />
      </div>
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded p-2">
          {error}
        </div>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Guardando..." : "Guardar y entrar"}
      </button>
    </form>
  );
}
