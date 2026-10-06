"use client";

import { useEffect, useRef } from "react";

// Input de 6 casillas para codigos OTP.
//
// UX:
//   - 6 inputs de 1 caracter cada uno con tamano tactil.
//   - autoavance al escribir.
//   - Backspace retrocede al casillero anterior cuando el actual esta vacio.
//   - Pegar el codigo completo distribuye los 6 digitos.
//   - inputMode="numeric" + pattern + autoComplete="one-time-code" para
//     que iOS Safari y Chrome ofrezcan auto-rellenar el codigo recibido
//     por SMS/notificacion.
//   - Flecha izq/der navega entre casilleros.
//   - Si se pasa `autoFocus` enfoca el primer casillero vacio al montar.
//
// Accesibilidad:
//   - Cada input tiene aria-label numerado.
//   - El agrupador tiene role="group" + aria-label general.
//   - Los inputs son HTML reales, no divs, para funcionar con teclado
//     fisico y screen readers.

type Props = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
};

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  "aria-label": ariaLabel = "Código de verificación de 6 dígitos",
}: Props) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Convertir value (string) a un array de 6 caracteres (relleno con "").
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (!autoFocus) return;
    const firstEmpty = digits.findIndex((d) => d === "");
    const idx = firstEmpty === -1 ? 5 : firstEmpty;
    inputsRef.current[idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  function setDigit(idx: number, digit: string) {
    const soloNum = digit.replace(/\D/g, "");
    const next = digits.slice();
    next[idx] = soloNum.slice(0, 1);
    const combinado = next.join("");
    onChange(combinado);
    if (combinado.length === 6 && !combinado.includes("")) {
      onComplete?.(combinado);
    }
  }

  function manejarInput(idx: number, e: React.FormEvent<HTMLInputElement>) {
    const raw = (e.target as HTMLInputElement).value;
    const soloNum = raw.replace(/\D/g, "");
    if (soloNum.length === 0) {
      setDigit(idx, "");
      return;
    }
    // Si el usuario pego varios digitos en una sola casilla, distribuir.
    if (soloNum.length > 1) {
      const chars = soloNum.slice(0, 6 - idx).split("");
      const next = digits.slice();
      for (let i = 0; i < chars.length; i++) {
        next[idx + i] = chars[i];
      }
      const combinado = next.join("");
      onChange(combinado);
      const nextIdx = Math.min(idx + chars.length, 5);
      inputsRef.current[nextIdx]?.focus();
      if (combinado.length === 6 && !combinado.includes("")) {
        onComplete?.(combinado);
      }
      return;
    }
    setDigit(idx, soloNum);
    // avanzar al siguiente si no estamos en el ultimo
    if (idx < 5) {
      inputsRef.current[idx + 1]?.focus();
    }
  }

  function manejarKeyDown(
    idx: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Backspace") {
      if (digits[idx]) {
        // vacia la casilla actual
        setDigit(idx, "");
        return;
      }
      // casilla vacia: retrocede
      if (idx > 0) {
        e.preventDefault();
        inputsRef.current[idx - 1]?.focus();
      }
      return;
    }
    if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      e.preventDefault();
      inputsRef.current[idx + 1]?.focus();
    }
  }

  function manejarPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const texto = e.clipboardData.getData("text") ?? "";
    const soloNum = texto.replace(/\D/g, "").slice(0, 6);
    if (soloNum.length === 0) return;
    e.preventDefault();
    const padded = soloNum.padEnd(6, "").slice(0, 6);
    onChange(padded.trimEnd());
    const nextIdx = Math.min(soloNum.length, 5);
    inputsRef.current[nextIdx]?.focus();
    if (soloNum.length === 6) onComplete?.(soloNum);
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center justify-between gap-2 sm:gap-3"
    >
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={(el) => {
            inputsRef.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete={idx === 0 ? "one-time-code" : "off"}
          aria-label={`Dígito ${idx + 1} de 6`}
          disabled={disabled}
          value={d}
          onChange={(e) => manejarInput(idx, e)}
          onKeyDown={(e) => manejarKeyDown(idx, e)}
          onPaste={manejarPaste}
          onFocus={(e) => e.currentTarget.select()}
          className={`w-11 h-14 sm:w-12 sm:h-14 text-center text-xl font-semibold rounded-xl border bg-white text-slate-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/15 ${
            d
              ? "border-brand-500 focus:border-brand-600"
              : "border-slate-300 focus:border-brand-500"
          } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        />
      ))}
    </div>
  );
}
