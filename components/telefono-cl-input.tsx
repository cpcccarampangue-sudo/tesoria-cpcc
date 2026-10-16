"use client";

import { useId, useMemo } from "react";
import { normalizarTelefonoCL } from "@/lib/normalizar";

// Input de telefono celular chileno con prefijo +56 fijo a la izquierda
// y 9 digitos editables a la derecha. El dato en `value` es siempre lo
// que ve el usuario (string de 0-9 digitos sin prefijo), y el callback
// `onChange` lo recibe tambien asi. Para persistir, el llamador toma los
// 9 digitos y los antepone con +56 (o usa normalizarTelefonoCL en el
// server). De este modo:
//   - El prefijo no se puede borrar ni editar.
//   - No importa si el usuario escribe espacios/guiones: se eliminan.
//   - Se bloquea a 9 digitos y se valida que el primero sea 9.
//
// Props:
//   value:    string con 0-9 digitos (sin el +56).
//   onChange: callback con la nueva cadena de digitos.
//   required: si true, pide el campo (default true porque este input
//             se usa en flujos donde el telefono es obligatorio).
//   id:       id del input (para htmlFor en labels externos).
//   label:    label mostrada arriba del campo. Si se omite, no renderiza
//             uno — el llamador puede poner su propio <label>.
//   helper:   texto chico abajo. Si se omite muestra un helper default
//             con el ejemplo "+56 9 5528 2630".
//   error:    si viene con texto, se renderiza como error en rojo y
//             marca aria-invalid.
//
// El input NO llama a onChange con digitos invalidos (letras, espacios);
// los filtra antes.

export type TelefonoCLInputProps = {
  value: string;
  onChange: (digitos: string) => void;
  required?: boolean;
  id?: string;
  label?: string | null;
  helper?: string | null;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function TelefonoCLInput({
  value,
  onChange,
  required = true,
  id,
  label = "Teléfono celular",
  helper = "Ej. 9 5528 2630. Se almacena como +56955282630.",
  error,
  disabled,
  autoFocus,
}: TelefonoCLInputProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const esValido = useMemo(() => {
    if (value.length === 0) return !required ? true : false;
    return normalizarTelefonoCL(`+56${value}`) !== null;
  }, [value, required]);
  const mostrarMensajeError = !!error;
  const mostrarAvisoFormato = !mostrarMensajeError && value.length > 0 && !esValido;

  return (
    <div>
      {label !== null && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
          {!required && (
            <span className="text-xs text-slate-500 font-normal">
              {" "}(opcional)
            </span>
          )}
        </label>
      )}
      <div
        className={
          "flex items-stretch rounded-xl border bg-white shadow-sm overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-brand-500/15 " +
          (mostrarMensajeError
            ? "border-red-400 focus-within:border-red-500"
            : "border-slate-300 focus-within:border-brand-500")
        }
      >
        <span
          aria-hidden="true"
          className="flex items-center px-3 bg-slate-50 text-sm text-slate-600 border-r border-slate-200 select-none font-mono"
        >
          +56
        </span>
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          pattern="[0-9]*"
          maxLength={9}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
          value={value}
          onChange={(e) => {
            const digitos = e.target.value.replace(/\D/g, "").slice(0, 9);
            onChange(digitos);
          }}
          placeholder="9 1234 5678"
          aria-invalid={mostrarMensajeError || mostrarAvisoFormato}
          aria-describedby={`${inputId}-help`}
          className="flex-1 h-[52px] px-4 bg-white text-sm text-slate-900 placeholder:text-slate-400 border-0 focus:outline-none focus:ring-0"
        />
      </div>
      <p
        id={`${inputId}-help`}
        className={
          "text-xs mt-2 leading-relaxed " +
          (mostrarMensajeError
            ? "text-red-700"
            : mostrarAvisoFormato
              ? "text-amber-700"
              : "text-slate-500")
        }
      >
        {mostrarMensajeError
          ? error
          : mostrarAvisoFormato
            ? "Ingresa 9 dígitos empezando con 9. Ejemplo: 955282630."
            : (helper ?? "")}
      </p>
    </div>
  );
}

// Helper del lado cliente: toma los digitos del input (sin +56) y
// devuelve el E.164 canonico "+56XXXXXXXXX" o null si no es valido.
// El server igualmente debe revalidar con normalizarTelefonoCL.
export function componerTelefonoCL(digitos: string): string | null {
  if (digitos.length !== 9 || digitos[0] !== "9") return null;
  if (!/^[0-9]{9}$/.test(digitos)) return null;
  return `+56${digitos}`;
}
