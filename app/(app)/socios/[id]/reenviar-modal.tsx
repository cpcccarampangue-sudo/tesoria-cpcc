"use client";

import { useState, useTransition } from "react";
import { registrarReenvioEmail } from "../actions";

// Validacion basica cliente. El servidor valida de nuevo (fuente de verdad).
function validarEmailCliente(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e) return "Ingresa un correo.";
  if (e.length > 254) return "Correo demasiado largo.";
  if (/[\r\n\0\t ,;]/.test(e))
    return "El correo contiene caracteres no permitidos.";
  const ok = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e);
  if (!ok) return "Formato de correo inválido.";
  return null;
}

export function ReenviarCorreoDialog({
  solicitudId,
  correoRegistrado,
  label,
  icon,
}: {
  solicitudId: string;
  correoRegistrado: string;
  // Texto del boton visible (ej. "Enviar QR por correo" o "Reenviar QR").
  label: string;
  // Emoji opcional al inicio del boton.
  icon?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<"registrado" | "otro">("registrado");
  const [emailOtro, setEmailOtro] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function cerrar() {
    if (pending) return;
    setAbierto(false);
    setError(null);
    // Mantenemos success visible al cerrar; se limpia al abrir de nuevo.
  }

  function abrir() {
    setAbierto(true);
    setError(null);
    setSuccess(null);
    setModo("registrado");
    setEmailOtro("");
  }

  function onEnviar() {
    setError(null);
    setSuccess(null);
    let override: string | null = null;
    if (modo === "otro") {
      const err = validarEmailCliente(emailOtro);
      if (err) {
        setError(err);
        return;
      }
      override = emailOtro.trim().toLowerCase();
    }
    startTransition(async () => {
      const res = await registrarReenvioEmail(solicitudId, {
        emailDestino: override,
      });
      if (res.ok) {
        setSuccess(`Correo enviado correctamente a ${res.destinatario_mask}.`);
        setAbierto(false);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn-primary"
        onClick={abrir}
        disabled={pending}
      >
        {icon ? `${icon} ` : ""}
        {label}
      </button>

      {success && !abierto && (
        <div className="text-sm bg-green-50 text-green-800 rounded-md p-3 mt-2">
          {success}
        </div>
      )}

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={cerrar}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reenviar-dialog-title"
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="reenviar-dialog-title"
              className="text-lg font-semibold text-slate-900"
            >
              Reenviar correo de socio
            </h2>

            <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Correo registrado
              </div>
              <div className="font-medium break-all">{correoRegistrado}</div>
            </div>

            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dest"
                  value="registrado"
                  checked={modo === "registrado"}
                  onChange={() => setModo("registrado")}
                  className="mt-1"
                  disabled={pending}
                />
                <span>Usar correo registrado</span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dest"
                  value="otro"
                  checked={modo === "otro"}
                  onChange={() => setModo("otro")}
                  className="mt-1"
                  disabled={pending}
                />
                <span>Enviar a otro correo</span>
              </label>

              {modo === "otro" && (
                <input
                  type="email"
                  className="input w-full mt-1"
                  placeholder="correo@ejemplo.com"
                  value={emailOtro}
                  onChange={(e) => setEmailOtro(e.target.value)}
                  maxLength={254}
                  autoFocus
                  disabled={pending}
                  aria-label="Correo alternativo"
                />
              )}
            </div>

            <p className="text-xs text-slate-500">
              El correo alternativo se usa <strong>solo</strong> para este
              envío. No modifica el correo registrado de la familia.
            </p>

            {error && (
              <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={cerrar}
                disabled={pending}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onEnviar}
                disabled={pending}
              >
                {pending ? "Enviando..." : "Enviar correo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
