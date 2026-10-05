"use client";

import { useState, useTransition } from "react";
import {
  buscarApoderadosAdmin,
  vincularSolicitudConApoderado,
} from "../actions";

type Opcion = { id: string; nombre: string; emails: string };

export function VincularFamilia({ solicitudId }: { solicitudId: string }) {
  const [q, setQ] = useState("");
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [buscando, startBuscar] = useTransition();
  const [vinculando, startVincular] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startBuscar(async () => {
      try {
        const res = await buscarApoderadosAdmin(q);
        setOpciones(res);
        if (res.length === 0) {
          setError(
            "No se encontraron familias con ese nombre. Verifica el nombre en /apoderados."
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function vincular(apoderadoId: string, nombre: string) {
    setError(null);
    setSuccess(null);
    startVincular(async () => {
      try {
        await vincularSolicitudConApoderado(solicitudId, apoderadoId);
        setSuccess(
          `Solicitud vinculada con "${nombre}". Pasó a estado "pendiente de pago".`
        );
        setOpciones([]);
        setQ("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">
        Busca la familia correcta en el listado del colegio y vincúlala a
        esta solicitud. Al vincular, la solicitud pasa a &quot;pendiente de
        pago&quot;.
      </p>

      <form onSubmit={buscar} className="flex gap-2">
        <input
          className="input flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar familia por nombre..."
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={buscando || q.trim().length < 2}
        >
          {buscando ? "..." : "Buscar"}
        </button>
      </form>

      {opciones.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {opciones.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => vincular(o.id, o.nombre)}
              disabled={vinculando}
              className="w-full text-left p-2 border border-slate-200 rounded-md hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
            >
              <div className="font-medium">{o.nombre}</div>
              {o.emails && (
                <div className="text-xs text-slate-500">{o.emails}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm bg-green-50 text-green-800 rounded-md p-3">
          {success}
        </div>
      )}
    </div>
  );
}
