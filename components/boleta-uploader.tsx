"use client";

import { useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Sube la boleta a Storage y devuelve el path. Muestra dos opciones:
//   - "Tomar foto" (abre la cámara del celular directamente)
//   - "Adjuntar archivo" (abre selector de archivos o galería)
export function BoletaUploader({
  value,
  onChange,
  targetId,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  targetId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
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
      const path = `${y}/${m}/${targetId}-${Date.now()}.${ext}`;

      const supabase = createSupabaseBrowserClient();
      const { error: e } = await supabase.storage
        .from("boletas")
        .upload(path, toUpload, {
          upsert: false,
          contentType: toUpload.type || undefined,
        });
      if (e) throw e;
      onChange(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir.");
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!value) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.storage.from("boletas").remove([value]);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-700 truncate">📎 {value}</span>
          <button
            type="button"
            className="text-xs text-red-600 hover:underline"
            onClick={remove}
          >
            Quitar
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
            >
              📷 Tomar foto
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              📎 Adjuntar archivo
            </button>
          </div>
          {/* input oculto: solo cámara del celular (capture=environment fuerza la trasera) */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {/* input oculto: cualquier archivo (galería, PDFs, etc.) */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </>
      )}
      {uploading && (
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
