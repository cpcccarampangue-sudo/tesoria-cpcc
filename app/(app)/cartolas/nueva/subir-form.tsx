"use client";

import { useRef, useState, useTransition } from "react";
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

export function SubirCartolaForm({ cuentas }: { cuentas: CuentaOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState<string>(cuentas[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cuenta = cuentas.find((c) => c.id === cuentaId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cuentaId || !cuenta) {
      setError("Selecciona una cuenta.");
      return;
    }
    if (!file) {
      setError("Selecciona el archivo Excel de la cartola.");
      return;
    }
    setUploading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "xlsx";
      const path = `${cuentaId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("cartolas")
        .upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
      if (upErr) throw new Error(upErr.message);

      startTransition(async () => {
        try {
          const { cartolaId, filas } = await importarCartola({
            cuenta_id: cuentaId,
            archivo_path: path,
            archivo_nombre: file.name,
          });
          router.push(`/cartolas/${cartolaId}?nuevas=${filas}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error al procesar.");
        } finally {
          setUploading(false);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir.");
      setUploading(false);
    }
  }

  const busy = uploading || pending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Cuenta</label>
        <select
          className="input"
          value={cuentaId}
          onChange={(e) => setCuentaId(e.target.value)}
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
        <label className="label">Archivo Excel de la cartola</label>
        <input
          ref={fileRef}
          type="file"
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          required
        />
        {file && (
          <div className="text-xs text-slate-500 mt-1">
            {file.name} · {Math.round(file.size / 1024)} KB
          </div>
        )}
      </div>

      {cuenta?.banco === "banco_estado" && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-3">
          <strong>Banco Estado:</strong> baja la cartola desde &quot;Cartola
          Histórica de Chequera Electrónica&quot; en formato Excel. Nombre
          típico: <code>Excel_Cartola_Historica_Chequera_Electronica N AAAA.xlsx</code>.
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

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {uploading
            ? "Subiendo..."
            : pending
            ? "Procesando..."
            : "Subir y parsear"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.back()}
          disabled={busy}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
