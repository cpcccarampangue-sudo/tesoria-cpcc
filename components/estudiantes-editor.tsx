"use client";

import { useState } from "react";
import type { EstudianteInput } from "@/app/(app)/apoderados/actions";

type Item = EstudianteInput & { _key: string };

let counter = 0;
function newKey() {
  counter += 1;
  return `est-${counter}-${Date.now()}`;
}

export function EstudiantesEditor({
  value,
  onChange,
}: {
  value: EstudianteInput[];
  onChange: (v: EstudianteInput[]) => void;
}) {
  const [items, setItems] = useState<Item[]>(
    (value.length > 0 ? value : [{ nombre: "", curso: "" }]).map((e) => ({
      ...e,
      _key: newKey(),
    }))
  );

  function propagate(next: Item[]) {
    setItems(next);
    onChange(
      next.map((it) => ({ id: it.id, nombre: it.nombre, curso: it.curso }))
    );
  }

  function update(i: number, patch: Partial<EstudianteInput>) {
    propagate(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function add() {
    propagate([...items, { _key: newKey(), nombre: "", curso: "" }]);
  }

  function remove(i: number) {
    const next = items.filter((_, idx) => idx !== i);
    propagate(next.length > 0 ? next : [{ _key: newKey(), nombre: "", curso: "" }]);
  }

  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it._key} className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              className="input"
              value={it.nombre}
              onChange={(e) => update(i, { nombre: e.target.value })}
              placeholder="Nombre del estudiante"
            />
          </div>
          <div className="w-28">
            <input
              className="input"
              value={it.curso ?? ""}
              onChange={(e) => update(i, { curso: e.target.value })}
              placeholder="Curso"
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-xs px-2"
            onClick={() => remove(i)}
            title="Quitar"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-sm text-brand-700 hover:underline"
        onClick={add}
      >
        + Agregar otro hijo/a
      </button>
    </div>
  );
}
