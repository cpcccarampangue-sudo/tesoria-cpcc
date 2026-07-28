"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function ApoderadosSearch({
  initialQ,
  initialCurso,
  initialSocio,
  cursos,
}: {
  initialQ: string;
  initialCurso: string;
  initialSocio: string;
  cursos: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [curso, setCurso] = useState(initialCurso);
  const [socio, setSocio] = useState(initialSocio);

  function apply(next: { q?: string; curso?: string; socio?: string }) {
    const sp = new URLSearchParams(params.toString());
    (["q", "curso", "socio"] as const).forEach((k) => {
      const v = next[k];
      if (v !== undefined) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
    });
    router.push(`/apoderados?${sp.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q, curso, socio });
      }}
      className="grid grid-cols-1 sm:grid-cols-5 gap-3"
    >
      <div className="sm:col-span-2">
        <label className="label">Buscar por familia</label>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ej: Cáceres"
        />
      </div>
      <div>
        <label className="label">Curso (hijos)</label>
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
      <div>
        <label className="label">Socio</label>
        <select
          className="input"
          value={socio}
          onChange={(e) => {
            setSocio(e.target.value);
            apply({ socio: e.target.value });
          }}
        >
          <option value="">Todos</option>
          <option value="si">Socios</option>
          <option value="no">No socios</option>
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className="btn-primary">
          Buscar
        </button>
        {(q || curso || socio) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setQ("");
              setCurso("");
              setSocio("");
              apply({ q: "", curso: "", socio: "" });
            }}
          >
            Limpiar
          </button>
        )}
      </div>
    </form>
  );
}
