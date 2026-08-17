"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatFecha } from "@/lib/formatters";
import type {
  LineaParaMatch,
  MovimientoParaMatch,
  ResultadoMatch,
} from "@/lib/cartolas/matcher";
import {
  confirmarMatchesAutomaticos,
  conciliarManualmente,
  desconciliar,
} from "./actions";

type LineaInfo = LineaParaMatch & { descripcion: string };
type MovInfo = MovimientoParaMatch & {
  cuenta_id: string;
  categoria_nombre: string | null;
};

type YaConciliada = {
  id: string;
  linea: LineaInfo;
  movimiento: {
    id: string;
    fecha: string;
    descripcion: string | null;
    monto: number;
    tipo: "ingreso" | "egreso";
    es_transferencia: boolean;
  };
  auto: boolean;
  ajuste_glosa: string | null;
};

export function ReconciliarClient({
  cartolaId,
  resultado,
  lineasIndex,
  movsIndex,
  yaConciliadas,
}: {
  cartolaId: string;
  resultado: ResultadoMatch;
  lineasIndex: Record<string, LineaInfo>;
  movsIndex: Record<string, MovInfo>;
  yaConciliadas: YaConciliada[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Exactos: pre-marcados, usuaria confirma con un botón
  const [seleccionadosExactos, setSeleccionadosExactos] = useState<Set<string>>(
    new Set(resultado.exactos.map((e) => e.linea_id))
  );

  const totalExactos = resultado.exactos.length;

  function toggleExacto(lineaId: string) {
    setSeleccionadosExactos((cur) => {
      const next = new Set(cur);
      if (next.has(lineaId)) next.delete(lineaId);
      else next.add(lineaId);
      return next;
    });
  }

  function confirmarExactos() {
    setError(null);
    setMsg(null);
    const pares = resultado.exactos.filter((e) =>
      seleccionadosExactos.has(e.linea_id)
    );
    if (pares.length === 0) {
      setError("No hay matches seleccionados.");
      return;
    }
    startTransition(async () => {
      try {
        const { insertadas } = await confirmarMatchesAutomaticos({
          cartolaId,
          pares: pares.map((p) => ({
            lineaId: p.linea_id,
            movimientoId: p.movimiento_id,
          })),
        });
        setMsg(`Se conciliaron ${insertadas} línea(s) automáticamente.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function vincularSugerencia(lineaId: string, movimientoId: string) {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      try {
        await conciliarManualmente({
          cartolaId,
          lineaId,
          movimientoIds: [movimientoId],
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  function deshacer(conciliacionId: string) {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      try {
        await desconciliar({ cartolaId, conciliacionId });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      }
    });
  }

  const lineasSinMatch = resultado.sin_match_ids.map((id) => lineasIndex[id]);
  // Todos los movimientos disponibles que NO estan asignados como candidatos exactos ni sugerencias
  const movsUsados = useMemo(() => {
    const s = new Set<string>();
    for (const e of resultado.exactos) s.add(e.movimiento_id);
    for (const g of resultado.sugerencias)
      for (const c of g.candidatos) s.add(c.movimiento_id);
    return s;
  }, [resultado]);
  const movsLibres = useMemo(
    () => Object.values(movsIndex).filter((m) => !movsUsados.has(m.id)),
    [movsIndex, movsUsados]
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      {msg && (
        <div className="text-sm bg-green-50 text-green-800 rounded-md p-3">
          {msg}
        </div>
      )}

      {/* Sección 1: Matches automáticos */}
      {resultado.exactos.length > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              Matches automáticos ({totalExactos})
            </h2>
            <button
              className="btn-primary text-sm"
              onClick={confirmarExactos}
              disabled={pending || seleccionadosExactos.size === 0}
            >
              {pending
                ? "Guardando..."
                : `Confirmar ${seleccionadosExactos.size} match(es)`}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Coincidencia exacta: mismo día, mismo monto, sin ambigüedad.
            Desmarca los que no quieras confirmar.
          </p>
          <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
            {resultado.exactos.map((e) => {
              const l = lineasIndex[e.linea_id];
              const m = movsIndex[e.movimiento_id];
              if (!l || !m) return null;
              const checked = seleccionadosExactos.has(l.id);
              return (
                <label
                  key={l.id}
                  className={`flex items-start gap-3 p-3 text-sm cursor-pointer hover:bg-slate-50 ${
                    checked ? "" : "opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleExacto(l.id)}
                  />
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs uppercase text-slate-500">
                        Línea de cartola
                      </div>
                      <div className="font-medium truncate">
                        {l.descripcion}
                      </div>
                      <div className="text-xs text-slate-600">
                        {formatFecha(l.fecha)} ·{" "}
                        <span
                          className={
                            l.tipo === "ingreso"
                              ? "text-green-700"
                              : "text-red-700"
                          }
                        >
                          {l.tipo === "ingreso" ? "+" : "−"}
                          {formatCLP(l.monto)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-slate-500">
                        Movimiento de la app
                      </div>
                      <div className="font-medium truncate">
                        {m.descripcion || "(sin descripción)"}
                      </div>
                      <div className="text-xs text-slate-600">
                        {formatFecha(m.fecha)} ·{" "}
                        <span
                          className={
                            m.tipo === "ingreso"
                              ? "text-green-700"
                              : "text-red-700"
                          }
                        >
                          {m.tipo === "ingreso" ? "+" : "−"}
                          {formatCLP(m.monto)}
                        </span>{" "}
                        {m.es_transferencia && (
                          <span className="badge-slate ml-1 text-[10px]">
                            ↔ transf
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {/* Sección 2: Sugerencias */}
      {resultado.sugerencias.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-semibold">
            Sugerencias por revisar ({resultado.sugerencias.length})
          </h2>
          <p className="text-xs text-slate-500">
            Mismo monto pero difieren en fecha (hasta ±3 días) o hay varios
            candidatos. Elige cuál linkear.
          </p>
          <div className="space-y-3">
            {resultado.sugerencias.map((s) => {
              const l = lineasIndex[s.linea_id];
              if (!l) return null;
              return (
                <div
                  key={l.id}
                  className="border border-amber-200 bg-amber-50/40 rounded-md p-3 space-y-2"
                >
                  <div className="text-sm">
                    <div className="font-medium">{l.descripcion}</div>
                    <div className="text-xs text-slate-600">
                      Línea de cartola · {formatFecha(l.fecha)} ·{" "}
                      <span
                        className={
                          l.tipo === "ingreso"
                            ? "text-green-700"
                            : "text-red-700"
                        }
                      >
                        {l.tipo === "ingreso" ? "+" : "−"}
                        {formatCLP(l.monto)}
                      </span>
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md bg-white text-sm">
                    {s.candidatos.map((c) => {
                      const m = movsIndex[c.movimiento_id];
                      if (!m) return null;
                      return (
                        <li
                          key={c.movimiento_id}
                          className="p-2 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate">
                              {m.descripcion || "(sin descripción)"}
                              {m.es_transferencia && (
                                <span className="badge-slate ml-1 text-[10px]">
                                  ↔ transf
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-600">
                              {formatFecha(m.fecha)} ·{" "}
                              {c.dias_diferencia === 0
                                ? "mismo día"
                                : `${c.dias_diferencia} día(s) de diferencia`}{" "}
                              · {m.categoria_nombre ?? "sin categoría"}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Link
                              href={`/movimientos/${m.id}`}
                              className="text-xs text-slate-600 hover:underline"
                            >
                              Ver
                            </Link>
                            <button
                              className="btn-primary text-xs"
                              disabled={pending}
                              onClick={() =>
                                vincularSugerencia(l.id, m.id)
                              }
                            >
                              Vincular
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sección 3: Sin match */}
      {lineasSinMatch.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-semibold">
            Sin match ({lineasSinMatch.length})
          </h2>
          <p className="text-xs text-slate-500">
            Líneas del banco que no encontraron movimiento con mismo monto
            en ±3 días. Vincúlala manualmente con un movimiento existente o
            crea uno nuevo desde el link.
          </p>
          <ul className="space-y-3">
            {lineasSinMatch.map((l) => (
              <SinMatchItem
                key={l.id}
                linea={l}
                movsLibres={movsLibres}
                onVincular={(movId) => vincularSugerencia(l.id, movId)}
                pending={pending}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Sección 4: Ya conciliadas */}
      {yaConciliadas.length > 0 && (
        <section className="card space-y-3">
          <details>
            <summary className="cursor-pointer font-semibold">
              Ya conciliadas ({yaConciliadas.length})
            </summary>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md mt-3 text-sm">
              {yaConciliadas.map((c) => (
                <li
                  key={c.id}
                  className="p-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="truncate">
                      <span className="text-xs text-slate-500">Cartola: </span>
                      {c.linea.descripcion} — {formatFecha(c.linea.fecha)} ·{" "}
                      {formatCLP(c.linea.monto)}
                    </div>
                    <div className="truncate">
                      <span className="text-xs text-slate-500">App: </span>
                      <Link
                        href={`/movimientos/${c.movimiento.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {c.movimiento.descripcion || "(sin descripción)"}
                      </Link>{" "}
                      — {formatFecha(c.movimiento.fecha)} ·{" "}
                      {formatCLP(c.movimiento.monto)}
                    </div>
                  </div>
                  {c.auto && (
                    <span className="badge-blue text-[10px]">auto</span>
                  )}
                  <button
                    className="text-xs text-red-600 hover:underline"
                    disabled={pending}
                    onClick={() => deshacer(c.id)}
                  >
                    Deshacer
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {resultado.exactos.length === 0 &&
        resultado.sugerencias.length === 0 &&
        resultado.sin_match_ids.length === 0 && (
          <div className="card text-sm text-slate-600">
            No hay líneas sin conciliar. 🎉
          </div>
        )}
    </div>
  );
}

function SinMatchItem({
  linea,
  movsLibres,
  onVincular,
  pending,
}: {
  linea: LineaInfo;
  movsLibres: MovInfo[];
  onVincular: (movId: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const arr = q
      ? movsLibres.filter(
          (m) =>
            (m.descripcion ?? "").toLowerCase().includes(q) ||
            String(m.monto).includes(q)
        )
      : movsLibres;
    return arr.slice(0, 50);
  }, [movsLibres, busqueda]);

  return (
    <li className="border border-slate-200 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{linea.descripcion}</div>
          <div className="text-xs text-slate-600">
            {formatFecha(linea.fecha)} ·{" "}
            <span
              className={
                linea.tipo === "ingreso" ? "text-green-700" : "text-red-700"
              }
            >
              {linea.tipo === "ingreso" ? "+" : "−"}
              {formatCLP(linea.monto)}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn-secondary text-xs"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Cerrar" : "Vincular con..."}
          </button>
          <Link
            href={`/movimientos/nuevo?tipo=${linea.tipo}`}
            className="text-xs text-brand-700 hover:underline self-center"
          >
            Crear movimiento nuevo →
          </Link>
        </div>
      </div>
      {open && (
        <div className="space-y-2 pt-2 border-t border-slate-200">
          <input
            className="input text-sm"
            placeholder="Buscar por descripción o monto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md max-h-64 overflow-y-auto text-sm">
            {filtrados.length === 0 ? (
              <li className="p-2 text-slate-500 text-xs">
                No hay movimientos que coincidan.
              </li>
            ) : (
              filtrados.map((m) => (
                <li
                  key={m.id}
                  className="p-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {m.descripcion || "(sin descripción)"}
                      {m.es_transferencia && (
                        <span className="badge-slate ml-1 text-[10px]">
                          ↔ transf
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {formatFecha(m.fecha)} ·{" "}
                      <span
                        className={
                          m.tipo === "ingreso"
                            ? "text-green-700"
                            : "text-red-700"
                        }
                      >
                        {m.tipo === "ingreso" ? "+" : "−"}
                        {formatCLP(m.monto)}
                      </span>{" "}
                      {m.tipo === linea.tipo && Number(m.monto) === Number(linea.monto) && (
                        <span className="badge-green ml-1 text-[10px]">
                          mismo monto
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn-primary text-xs"
                    disabled={pending}
                    onClick={() => onVincular(m.id)}
                  >
                    Vincular
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </li>
  );
}
