"use client";

import { useState } from "react";
import type { ContactoInput } from "@/app/(app)/apoderados/actions";
import { RELACION_LABELS, type ContactoRelacion } from "@/lib/types";

type Item = ContactoInput & { _key: string };

let counter = 0;
function newKey() {
  counter += 1;
  return `ctx-${counter}-${Date.now()}`;
}

const RELACIONES: ContactoRelacion[] = [
  "padre",
  "madre",
  "apoderado_cuenta",
  "apoderado_academico",
  "otro",
];

export function ContactosEditor({
  value,
  onChange,
}: {
  value: ContactoInput[];
  onChange: (v: ContactoInput[]) => void;
}) {
  const [items, setItems] = useState<Item[]>(
    (value.length > 0
      ? value
      : ([
          { nombre: "", email: null, telefono: null, relacion: "padre" },
        ] as ContactoInput[])
    ).map((c) => ({ ...c, _key: newKey() }))
  );

  function propagate(next: Item[]) {
    setItems(next);
    onChange(
      next.map((it) => ({
        id: it.id,
        nombre: it.nombre,
        email: it.email,
        telefono: it.telefono,
        relacion: it.relacion,
      }))
    );
  }

  function update(i: number, patch: Partial<ContactoInput>) {
    propagate(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function add() {
    propagate([
      ...items,
      {
        _key: newKey(),
        nombre: "",
        email: null,
        telefono: null,
        relacion: "madre",
      },
    ]);
  }

  function remove(i: number) {
    const next = items.filter((_, idx) => idx !== i);
    propagate(
      next.length > 0
        ? next
        : [
            {
              _key: newKey(),
              nombre: "",
              email: null,
              telefono: null,
              relacion: "padre",
            },
          ]
    );
  }

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div
          key={it._key}
          className="border border-slate-200 rounded-md p-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <select
              className="input w-auto text-sm"
              value={it.relacion}
              onChange={(e) =>
                update(i, { relacion: e.target.value as ContactoRelacion })
              }
            >
              {RELACIONES.map((r) => (
                <option key={r} value={r}>
                  {RELACION_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs text-red-600 hover:underline ml-auto"
              onClick={() => remove(i)}
            >
              Quitar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              className="input"
              value={it.nombre}
              onChange={(e) => update(i, { nombre: e.target.value })}
              placeholder="Nombre completo"
            />
            <input
              className="input"
              type="email"
              value={it.email ?? ""}
              onChange={(e) => update(i, { email: e.target.value || null })}
              placeholder="Email"
            />
            <input
              className="input"
              value={it.telefono ?? ""}
              onChange={(e) => update(i, { telefono: e.target.value || null })}
              placeholder="Teléfono"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="text-sm text-brand-700 hover:underline"
        onClick={add}
      >
        + Agregar otro contacto
      </button>
    </div>
  );
}
