"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DIRECTIVA_CARGO_LABEL, type DirectivaCargo } from "@/lib/types";

// Cargos que tiene sentido ofrecer como "firmantes junto al tesorero".
// El tesorero siempre firma; el usuario elige si acompanan otros cargos.
const CARGOS_ACOMPANANTES: DirectivaCargo[] = [
  "presidente",
  "vicepresidente",
  "secretario",
];

export function ActaSelector({
  movimientoId,
  cargosActivos,
}: {
  movimientoId: string;
  cargosActivos: DirectivaCargo[];
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Cerrar al hacer click fuera.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Cargos disponibles como acompanantes (tienen miembro activo).
  const acompanantes = CARGOS_ACOMPANANTES.filter((c) =>
    cargosActivos.includes(c)
  );

  const hrefBase = `/imprimir/movimientos/${movimientoId}`;

  // Caso simple: si no hay acompanantes disponibles, un solo boton directo.
  if (acompanantes.length === 0) {
    return (
      <Link
        href={`${hrefBase}?firmantes=tesorero`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary"
        title="Genera un acta de recibo de dineros con firma del tesorero"
      >
        🧾 Generar acta
      </Link>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen((o) => !o)}
        title="Elegir firmantes del acta"
      >
        🧾 Generar acta ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 w-64 rounded-md border border-slate-200 bg-white shadow-lg py-1 text-sm">
          <Link
            href={`${hrefBase}?firmantes=tesorero`}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 hover:bg-slate-100"
            onClick={() => setOpen(false)}
          >
            Solo Tesorero/a
          </Link>
          {acompanantes.map((c) => (
            <Link
              key={c}
              href={`${hrefBase}?firmantes=tesorero,${c}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              Tesorero/a + {DIRECTIVA_CARGO_LABEL[c]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
