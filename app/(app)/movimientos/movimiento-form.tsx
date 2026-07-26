"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BoletaUploader } from "@/components/boleta-uploader";
import { parseCLPInput, formatNumber, todayISO } from "@/lib/formatters";
import type { MovTipo } from "@/lib/types";
import { crearMovimiento, actualizarMovimiento } from "./actions";

type CategoriaOption = {
  id: string;
  nombre: string;
  tipo: MovTipo;
  activa: boolean;
};

type EventoOption = { id: string; nombre: string };

type Initial = {
  id?: string;
  fecha?: string;
  tipo?: MovTipo;
  monto?: number;
  descripcion?: string | null;
  categoria_id?: string | null;
  evento_id?: string | null;
  boleta_path?: string | null;
};

export function MovimientoForm({
  categorias,
  eventos,
  initialTipo = "ingreso",
  initialEventoId = null,
  initial,
}: {
  categorias: CategoriaOption[];
  eventos: EventoOption[];
  initialTipo?: MovTipo;
  initialEventoId?: string | null;
  initial?: Initial;
}) {
  const router = useRouter();
  const isEdit = !!initial?.id;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fecha: initial?.fecha ?? todayISO(),
    tipo: (initial?.tipo ?? initialTipo) as MovTipo,
    monto: initial?.monto ? String(initial.monto) : "",
    descripcion: initial?.descripcion ?? "",
    categoria_id: initial?.categoria_id ?? "",
    evento_id: initial?.evento_id ?? initialEventoId ?? "",
  });
  const [boletaPath, setBoletaPath] = useState<string | null>(
    initial?.boleta_path ?? null
  );

  const montoNum = parseCLPInput(form.monto);

  const catsFiltradas = useMemo(
    () => categorias.filter((c) => c.tipo === form.tipo),
    [categorias, form.tipo]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!montoNum || montoNum <= 0) {
      setError("Ingresa un monto mayor a 0.");
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          fecha: form.fecha,
          tipo: form.tipo,
          monto: montoNum,
          descripcion: form.descripcion.trim() || null,
          categoria_id: form.categoria_id || null,
          evento_id: form.evento_id || null,
          boleta_path: boletaPath,
        };
        if (isEdit && initial?.id) {
          await actualizarMovimiento(initial.id, payload);
          router.push(`/movimientos/${initial.id}`);
        } else {
          const id = await crearMovimiento(payload);
          router.push(`/movimientos/${id}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label">Fecha</label>
          <input
            type="date"
            className="input"
            value={form.fecha}
            onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select
            className="input"
            value={form.tipo}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                tipo: e.target.value as MovTipo,
                categoria_id: "",
              }))
            }
          >
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Monto (CLP)</label>
          <input
            className="input"
            value={form.monto}
            onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
            inputMode="numeric"
            placeholder="50000"
          />
          {montoNum !== null && (
            <div className="text-xs text-slate-500 mt-1">
              ${formatNumber(montoNum)}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Categoría</label>
          <select
            className="input"
            value={form.categoria_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, categoria_id: e.target.value }))
            }
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
            value={form.evento_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, evento_id: e.target.value }))
            }
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
          value={form.descripcion}
          onChange={(e) =>
            setForm((f) => ({ ...f, descripcion: e.target.value }))
          }
          placeholder="Ej: pago proveedor globos"
        />
      </div>

      <div>
        <label className="label">Boleta (imagen o PDF, opcional)</label>
        <BoletaUploader
          value={boletaPath}
          onChange={setBoletaPath}
          targetId={initial?.id ?? "nuevo"}
        />
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : isEdit ? "Guardar cambios" : "Guardar"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.back()}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
