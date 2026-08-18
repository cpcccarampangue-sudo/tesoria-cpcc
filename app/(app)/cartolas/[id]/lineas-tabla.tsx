"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatFecha } from "@/lib/formatters";
import type { CartolaLinea } from "@/lib/types";
import { crearMovimientoYConciliar } from "./reconciliar/actions";

type LineaMov = {
  movimiento_id: string;
  descripcion: string | null;
  fecha: string;
  monto: number;
  tipo: string;
};

type LineaExt = CartolaLinea & { movs: LineaMov[] };

type Categoria = {
  id: string;
  nombre: string;
  tipo: "ingreso" | "egreso";
  activa: boolean;
};

type Evento = { id: string; nombre: string };

export function LineasTabla({
  cartolaId,
  cuentaId,
  lineas,
  categorias,
  eventos,
}: {
  cartolaId: string;
  cuentaId: string;
  lineas: LineaExt[];
  categorias: Categoria[];
  eventos: Evento[];
}) {
  const [filtroEstado, setFiltroEstado] = useState<
    "todas" | "sin_cruzar" | "conciliadas"
  >("todas");
  const [busqueda, setBusqueda] = useState("");

  const filtradas = useMemo(() => {
    let arr = lineas;
    if (filtroEstado === "sin_cruzar") arr = arr.filter((l) => !l.conciliado);
    if (filtroEstado === "conciliadas") arr = arr.filter((l) => l.conciliado);
    const q = busqueda.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (l) =>
          l.descripcion.toLowerCase().includes(q) ||
          String(l.monto).includes(q)
      );
    }
    return arr;
  }, [lineas, filtroEstado, busqueda]);

  const conteos = useMemo(
    () => ({
      todas: lineas.length,
      sin_cruzar: lineas.filter((l) => !l.conciliado).length,
      conciliadas: lineas.filter((l) => l.conciliado).length,
    }),
    [lineas]
  );

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Filtrar</label>
          <select
            className="input"
            value={filtroEstado}
            onChange={(e) =>
              setFiltroEstado(
                e.target.value as "todas" | "sin_cruzar" | "conciliadas"
              )
            }
          >
            <option value="todas">Todas ({conteos.todas})</option>
            <option value="sin_cruzar">
              Sin cruzar ({conteos.sin_cruzar})
            </option>
            <option value="conciliadas">
              Conciliadas ({conteos.conciliadas})
            </option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="label">Buscar</label>
          <input
            className="input"
            placeholder="Descripción o monto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Fecha</th>
              <th className="table-th">Descripción</th>
              <th className="table-th">Canal / Ref.</th>
              <th className="table-th text-right">Monto</th>
              <th className="table-th text-right">Saldo</th>
              <th className="table-th">Estado</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtradas.map((l) => (
              <LineaFila
                key={l.id}
                linea={l}
                cartolaId={cartolaId}
                cuentaId={cuentaId}
                categorias={categorias}
                eventos={eventos}
              />
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={7} className="table-td text-sm text-slate-500">
                  No hay líneas que coincidan con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LineaFila({
  linea,
  cartolaId,
  cuentaId,
  categorias,
  eventos,
}: {
  linea: LineaExt;
  cartolaId: string;
  cuentaId: string;
  categorias: Categoria[];
  eventos: Evento[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [categoriaId, setCategoriaId] = useState<string>("");
  const [eventoId, setEventoId] = useState<string>("");
  const [descripcion, setDescripcion] = useState<string>(linea.descripcion);

  const catsFiltradas = useMemo(
    () => categorias.filter((c) => c.tipo === linea.tipo),
    [categorias, linea.tipo]
  );

  function guardar() {
    setError(null);
    if (!cuentaId) {
      setError("La cartola no tiene cuenta asignada.");
      return;
    }
    startTransition(async () => {
      try {
        await crearMovimientoYConciliar({
          cartolaId,
          lineaId: linea.id,
          cuenta_id: cuentaId,
          categoria_id: categoriaId || null,
          evento_id: eventoId || null,
          descripcion: descripcion.trim(),
          fecha: linea.fecha,
          tipo: linea.tipo,
          monto: Number(linea.monto),
        });
        setExpanded(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <>
      <tr className={linea.conciliado ? "bg-green-50/40" : ""}>
        <td className="table-td">{formatFecha(linea.fecha)}</td>
        <td className="table-td max-w-md truncate" title={linea.descripcion}>
          {linea.descripcion}
        </td>
        <td className="table-td text-xs text-slate-500">
          {linea.canal ?? linea.referencia_externa ?? "—"}
        </td>
        <td
          className={`table-td text-right font-semibold ${
            linea.tipo === "ingreso" ? "text-green-700" : "text-red-700"
          }`}
        >
          {linea.tipo === "ingreso" ? "+" : "−"}
          {formatCLP(linea.monto)}
        </td>
        <td className="table-td text-right text-xs text-slate-500">
          {linea.saldo_despues != null ? formatCLP(linea.saldo_despues) : "—"}
        </td>
        <td className="table-td">
          {linea.conciliado ? (
            <span className="badge-green text-xs">conciliada</span>
          ) : (
            <span className="badge-slate text-xs">sin cruzar</span>
          )}
        </td>
        <td className="table-td text-right">
          {linea.conciliado ? (
            linea.movs.length === 1 ? (
              <Link
                href={`/movimientos/${linea.movs[0].movimiento_id}`}
                className="text-xs text-brand-700 hover:underline"
              >
                Ver movimiento
              </Link>
            ) : (
              <span className="text-xs text-slate-500">
                {linea.movs.length} movs
              </span>
            )
          ) : (
            <button
              type="button"
              className="text-xs text-brand-700 hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Cerrar" : "Categorizar"}
            </button>
          )}
        </td>
      </tr>
      {expanded && !linea.conciliado && (
        <tr className="bg-slate-50/60">
          <td colSpan={7} className="p-3">
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                Se creará un movimiento tipo <strong>{linea.tipo}</strong> por{" "}
                <strong>{formatCLP(linea.monto)}</strong> en la fecha{" "}
                <strong>{formatFecha(linea.fecha)}</strong>, con la cuenta de
                esta cartola, y se vinculará automáticamente a esta línea.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Categoría</label>
                  <select
                    className="input"
                    value={categoriaId}
                    onChange={(e) => setCategoriaId(e.target.value)}
                  >
                    <option value="">— sin categoría —</option>
                    {catsFiltradas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Evento (opcional)</label>
                  <select
                    className="input"
                    value={eventoId}
                    onChange={(e) => setEventoId(e.target.value)}
                  >
                    <option value="">— no asociado —</option>
                    {eventos.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Descripción</label>
                <input
                  className="input"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              </div>
              {error && (
                <div className="text-sm bg-red-50 text-red-800 rounded-md p-2">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  className="btn-primary text-sm"
                  onClick={guardar}
                  disabled={pending}
                >
                  {pending ? "Guardando..." : "Crear y vincular"}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setExpanded(false)}
                  disabled={pending}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
