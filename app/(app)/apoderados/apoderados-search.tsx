"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function ApoderadosSearch({
  initialQ,
  initialCurso,
  cursos,
}: {
  initialQ: string;
  initialCurso: string;
  cursos: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [curso, setCurso] = useState(initialCurso);

  function apply(next: { q?: string; curso?: string }) {
    const sp = new URLSearchParams(params.toString());
    if (next.q !== undefined) {
      if (next.q) sp.set("q", next.q);
      else sp.delete("q");
    }
    if (next.curso !== undefined) {
      if (next.curso) sp.set("curso", next.curso);
      else sp.delete("curso");
    }
    router.push(`/apoderados?${sp.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q, curso });
      }}
      className="grid grid-cols-1 sm:grid-cols-4 gap-3"
    >
      <div className="sm:col-span-2">
        <label className="label">Buscar por nombre</label>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ej: Juan Pérez"
        />
      </div>
      <div>
        <label className="label">Curso</label>
        <select
          className="input"
          value={curso}
          onChange={(e) => {
            setCurso(e.target.value);
            apply({ curso: e.target.value });
          }}
        >
          <option value="">Todos</option>
          {cursos.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className="btn-primary">
          Buscar
        </button>
        {(q || curso) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setQ("");
              setCurso("");
              apply({ q: "", curso: "" });
            }}
          >
            Limpiar
          </button>
        )}
      </div>
    </form>
  );
}
