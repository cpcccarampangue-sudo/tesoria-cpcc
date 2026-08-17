"use client";

import { useRef, useState, useTransition } from "react";
import imageCompression from "browser-image-compression";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ADJUNTO_TIPO_LABEL,
  type AdjuntoTipo,
  type MovimientoAdjunto,
} from "@/lib/types";
import {
  agregarAdjunto,
  eliminarAdjunto,
  getAdjuntoSignedUrl,
} from "@/app/(app)/movimientos/actions";

export type AdjuntoLocal = {
  storage_path: string;
  nombre_original: string | null;
  tipo: AdjuntoTipo;
  descripcion: string | null;
};

const TIPOS: AdjuntoTipo[] = [
  "boleta",
  "comprobante",
  "cotizacion",
  "contrato",
  "foto",
  "otro",
];

type Props =
  | {
      mode: "local";
      uploadPrefix: string;
      initialLocal?: AdjuntoLocal[];
      onChange: (adjuntos: AdjuntoLocal[]) => void;
    }
  | {
      mode: "persisted";
      movimientoId: string;
      initial: MovimientoAdjunto[];
      uploadPrefix: string;
    };

export function AdjuntosManager(props: Props) {
  const isPersisted = props.mode === "persisted";
  const [items, setItems] = useState<
    Array<
      | { kind: "persisted"; adj: MovimientoAdjunto }
      | { kind: "local"; adj: AdjuntoLocal }
    >
  >(() =>
    isPersisted
      ? props.initial.map((a) => ({ kind: "persisted" as const, adj: a }))
      : (props.initialLocal ?? []).map((a) => ({
          kind: "local" as const,
          adj: a,
        }))
  );

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingRemove, startRemove] = useTransition();
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [nuevoTipo, setNuevoTipo] = useState<AdjuntoTipo>("boleta");
  const [nuevaDesc, setNuevaDesc] = useState("");

  function notifyChange(
    next: Array<
      | { kind: "persisted"; adj: MovimientoAdjunto }
      | { kind: "local"; adj: AdjuntoLocal }
    >
  ) {
    if (!isPersisted) {
      const locales = next
        .filter((x): x is { kind: "local"; adj: AdjuntoLocal } => x.kind === "local")
        .map((x) => x.adj);
      (props as Extract<Props, { mode: "local" }>).onChange(locales);
    }
  }

  async function uploadFile(file: File): Promise<string | null> {
    setError(null);
    try {
      let toUpload: File = file;
      if (file.type.startsWith("image/")) {
        toUpload = await imageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
          fileType: "image/jpeg",
        });
      }
      if (toUpload.size > 5 * 1024 * 1024) {
        throw new Error("El archivo pesa más de 5 MB después de comprimir.");
      }
      const ext = getExtension(toUpload.name, toUpload.type);
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const path = `${y}/${m}/${props.uploadPrefix}-${Date.now()}.${ext}`;

      const supabase = createSupabaseBrowserClient();
      const { error: e } = await supabase.storage
        .from("boletas")
        .upload(path, toUpload, {
          upsert: false,
          contentType: toUpload.type || undefined,
        });
      if (e) throw e;
      return path;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir.");
      return null;
    }
  }

  async function handleFilePicked(file: File) {
    setUploading(true);
    const path = await uploadFile(file);
    setUploading(false);
    if (!path) return;

    const local: AdjuntoLocal = {
      storage_path: path,
      nombre_original: file.name,
      tipo: nuevoTipo,
      descripcion: nuevaDesc.trim() || null,
    };

    if (isPersisted) {
      startSave(async () => {
        try {
          const id = await agregarAdjunto(
            (props as Extract<Props, { mode: "persisted" }>).movimientoId,
            local
          );
          const persisted: MovimientoAdjunto = {
            id,
            movimiento_id: (props as Extract<Props, { mode: "persisted" }>)
              .movimientoId,
            storage_path: local.storage_path,
            nombre_original: local.nombre_original,
            tipo: local.tipo,
            descripcion: local.descripcion,
            subido_por: null,
            subido_en: new Date().toISOString(),
          };
          setItems((cur) => [...cur, { kind: "persisted", adj: persisted }]);
          setNuevaDesc("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error al guardar.");
        }
      });
    } else {
      setItems((cur) => {
        const next = [...cur, { kind: "local" as const, adj: local }];
        notifyChange(next);
        return next;
      });
      setNuevaDesc("");
    }
  }

  function removeAt(index: number) {
    const item = items[index];
    if (item.kind === "persisted") {
      startRemove(async () => {
        try {
          await eliminarAdjunto(item.adj.id);
          setItems((cur) => cur.filter((_, i) => i !== index));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error al eliminar.");
        }
      });
    } else {
      // Local: borramos del storage tambien para no dejar huerfano
      startRemove(async () => {
        try {
          const supabase = createSupabaseBrowserClient();
          await supabase.storage
            .from("boletas")
            .remove([item.adj.storage_path]);
        } catch {
          // silencioso: si falla queda huerfano pero no bloquea al usuario
        }
        setItems((cur) => {
          const next = cur.filter((_, i) => i !== index);
          notifyChange(next);
          return next;
        });
      });
    }
  }

  async function openLink(path: string) {
    const url = await getAdjuntoSignedUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("No se pudo generar el enlace.");
  }

  const busy = uploading || pendingSave || pendingRemove;

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
          {items.map((it, i) => {
            const isPer = it.kind === "persisted";
            const a = it.adj;
            return (
              <li
                key={isPer ? (it.adj as MovimientoAdjunto).id : `local-${i}`}
                className="flex items-center gap-3 p-2 text-sm"
              >
                <span className="badge-slate text-[10px] uppercase">
                  {ADJUNTO_TIPO_LABEL[a.tipo]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {a.descripcion || a.nombre_original || "(sin descripción)"}
                  </div>
                  {a.descripcion && a.nombre_original && (
                    <div className="text-xs text-slate-500 truncate">
                      {a.nombre_original}
                    </div>
                  )}
                </div>
                {isPer && (
                  <button
                    type="button"
                    className="text-xs text-brand-700 hover:underline"
                    onClick={() => openLink(a.storage_path)}
                  >
                    Ver
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  disabled={busy}
                  onClick={() => removeAt(i)}
                >
                  Quitar
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-md border border-dashed border-slate-300 p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="label">Tipo</label>
            <select
              className="input"
              value={nuevoTipo}
              onChange={(e) => setNuevoTipo(e.target.value as AdjuntoTipo)}
              disabled={busy}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ADJUNTO_TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Descripción (opcional)</label>
            <input
              className="input"
              value={nuevaDesc}
              onChange={(e) => setNuevaDesc(e.target.value)}
              placeholder="Ej: giro cajero 05/ago"
              disabled={busy}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            📷 Tomar foto y agregar
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            📎 Adjuntar archivo
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFilePicked(f);
            e.target.value = "";
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFilePicked(f);
            e.target.value = "";
          }}
        />
      </div>

      {(uploading || pendingSave) && (
        <div className="text-xs text-slate-500">Subiendo, un momento...</div>
      )}
      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-2">
          {error}
        </div>
      )}
    </div>
  );
}

function getExtension(name: string, type: string): string {
  const fromName = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : "";
  if (fromName) return fromName;
  if (type === "application/pdf") return "pdf";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "bin";
}
