"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Option = { id: string; nombre: string };

export function MovimientosFilters({
  eventos,
  categorias,
  cuentas,
}: {
  eventos: Option[];
  categorias: Option[];
  cuentas: Option[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [tipo, setTipo] = useState(sp.get("tipo") ?? "");
  const [evento, setEvento] = useState(sp.get("evento_id") ?? "");
  const [categoria, setCategoria] = useState(sp.get("categoria_id") ?? "");
  const [cuenta, setCuenta] = useState(sp.get("cuenta_id") ?? "");
  const [desde, setDesde] = useState(sp.get("desde") ?? "");
  const [hasta, setHasta] = useState(sp.get("hasta") ?? "");
  const [sinCartola, setSinCartola] = useState(sp.get("sin_cartola") === "1");

  function apply() {
    const p = new URLSearchParams();
    if (tipo) p.set("tipo", tipo);
    if (evento) p.set("evento_id", evento);
    if (categoria) p.set("categoria_id", categoria);
    if (cuenta) p.set("cuenta_id", cuenta);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (sinCartola) p.set("sin_cartola", "1");
    router.push(`/movimientos?${p.toString()}`);
  }
  function clear() {
    setTipo("");
    setEvento("");
    setCategoria("");
    setCuenta("");
    setDesde("");
    setHasta("");
    setSinCartola(false);
    router.push(`/movimientos`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end"
    >
      <div>
        <label className="label">Tipo</label>
        <select
          className="input"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="ingreso">Ingresos</option>
          <option value="egreso">Egresos</option>
        </select>
      </div>
      <div>
        <label className="label">Categoría</label>
        <select
          className="input"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          <option value="">Todas</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Cuenta</label>
        <select
          className="input"
          value={cuenta}
          onChange={(e) => setCuenta(e.target.value)}
        >
          <option value="">Todas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Evento</label>
        <select
          className="input"
          value={evento}
          onChange={(e) => setEvento(e.target.value)}
        >
          <option value="">Todos</option>
          {eventos.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Desde</label>
        <input
          type="date"
          className="input"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Hasta</label>
        <input
          type="date"
          className="input"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
        />
      </div>
      <div className="col-span-2 sm:col-span-6 flex flex-wrap gap-2 items-center">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sinCartola}
            onChange={(e) => setSinCartola(e.target.checked)}
          />
          Solo movimientos sin match en cartola
        </label>
        <div className="flex-1" />
        <button className="btn-primary">Aplicar filtros</button>
        <button type="button" className="btn-secondary" onClick={clear}>
          Limpiar
        </button>
      </div>
    </form>
  );
}
