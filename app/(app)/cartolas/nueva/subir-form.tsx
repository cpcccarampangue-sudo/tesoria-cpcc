"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { importarCartola } from "../actions";

type CuentaOption = {
  id: string;
  nombre: string;
  color: string | null;
  es_principal: boolean;
  activa: boolean;
  banco: string | null;
};

const BANCO_LABEL: Record<string, string> = {
  banco_estado: "Banco Estado",
  banco_chile: "Banco de Chile",
};

type LogItem =
  | { kind: "ok"; nombre: string; cartolaId: string; filas: number }
  | { kind: "err"; nombre: string; mensaje: string };

export function SubirCartolaForm({ cuentas }: { cuentas: CuentaOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState<string>(cuentas[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cuenta = cuentas.find((c) => c.id === cuentaId);

  async function procesarArchivo(
    file: File,
    supabase: ReturnType<typeof createSupabaseBrowserClient>
  ): Promise<LogItem> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "xlsx";
    const path = `${cuentaId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("cartolas")
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (upErr) return { kind: "err", nombre: file.name, mensaje: upErr.message };
    try {
      const { cartolaId, filas } = await importarCartola({
        cuenta_id: cuentaId,
        archivo_path: path,
        archivo_nombre: file.name,
      });
      return { kind: "ok", nombre: file.name, cartolaId, filas };
    } catch (err) {
      return {
        kind: "err",
        nombre: file.name,
        mensaje: err instanceof Error ? err.message : "Error inesperado.",
      };
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLog([]);
    if (!cuentaId || !cuenta) {
      setError("Selecciona una cuenta.");
      return;
    }
    if (files.length === 0) {
      setError("Selecciona al menos un archivo.");
      return;
    }
    setBusy(true);
    setProgreso({ hecho: 0, total: files.length });
    const supabase = createSupabaseBrowserClient();

    for (let i = 0; i < files.length; i++) {
      const result = await procesarArchivo(files[i], supabase);
      setLog((cur) => [...cur, result]);
      setProgreso({ hecho: i + 1, total: files.length });
    }

    setBusy(false);
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  const okCount = log.filter((l) => l.kind === "ok").length;
  const errCount = log.filter((l) => l.kind === "err").length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Cuenta</label>
        <select
          className="input"
          value={cuentaId}
          onChange={(e) => setCuentaId(e.target.value)}
          disabled={busy}
          required
        >
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} {c.es_principal ? "(principal)" : ""} —{" "}
              {BANCO_LABEL[c.banco ?? ""] ?? c.banco}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">
          Archivo(s) Excel de la cartola (puedes seleccionar varios)
        </label>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          onChange={(e) =>
            setFiles(e.target.files ? Array.from(e.target.files) : [])
          }
          disabled={busy}
          required
        />
        {files.length > 0 && (
          <div className="text-xs text-slate-500 mt-1">
            {files.length} archivo(s) seleccionado(s)
          </div>
        )}
      </div>

      {cuenta?.banco === "banco_estado" && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
          <strong>Banco Estado:</strong> baja las cartolas desde &quot;Cartola
          Histórica de Chequera Electrónica&quot; en formato Excel. Nombre
          típico:{" "}
          <code>Excel_Cartola_Historica_Chequera_Electronica N AAAA.xlsx</code>.
        </div>
      )}
      {cuenta?.banco === "banco_chile" && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
          <strong>Banco de Chile:</strong> baja la cartola histórica desde el
          sitio de la Cuenta FAN en formato Excel (.xls). Nombre típico:{" "}
          <code>cartola_DDMMYYYY.xls</code>.
        </div>
      )}

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      {progreso && (
        <div className="text-sm bg-slate-50 border border-slate-200 rounded-md p-3">
          {busy
            ? `Procesando ${progreso.hecho} / ${progreso.total}...`
            : `Listo: ${okCount} OK · ${errCount} con error de ${progreso.total} archivo(s).`}
        </div>
      )}

      {log.length > 0 && (
        <div className="border border-slate-200 rounded-md max-h-64 overflow-y-auto">
          <ul className="divide-y divide-slate-100 text-sm">
            {log.map((l, i) => (
              <li key={i} className="p-2 flex items-start gap-2">
                {l.kind === "ok" ? (
                  <span className="text-green-700 font-semibold">✓</span>
                ) : (
                  <span className="text-red-700 font-semibold">✗</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{l.nombre}</div>
                  {l.kind === "ok" ? (
                    <div className="text-xs text-slate-500">
                      {l.filas} línea(s) parseadas —{" "}
                      <Link
                        href={`/cartolas/${l.cartolaId}`}
                        className="text-brand-700 hover:underline"
                      >
                        ver cartola
                      </Link>
                    </div>
                  ) : (
                    <div className="text-xs text-red-700">{l.mensaje}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy
            ? `Procesando ${progreso?.hecho ?? 0}/${progreso?.total ?? 0}...`
            : "Subir y parsear"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push("/cartolas")}
          disabled={busy}
        >
          {log.length > 0 ? "Ir al listado" : "Cancelar"}
        </button>
      </div>
    </form>
  );
}
