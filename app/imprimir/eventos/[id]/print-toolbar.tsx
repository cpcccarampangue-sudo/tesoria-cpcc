"use client";

export function PrintToolbar({ eventoId }: { eventoId: string }) {
  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3">
      <div className="text-sm text-slate-600">
        Vista lista para imprimir. Usa el botón{" "}
        <strong>Imprimir / Guardar PDF</strong> o presiona{" "}
        <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs">
          Ctrl
        </kbd>{" "}
        +{" "}
        <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs">
          P
        </kbd>
        .
      </div>
      <div className="flex items-center gap-2">
        <a href={`/eventos/${eventoId}`} className="btn-secondary">
          ← Volver al evento
        </a>
        <button
          type="button"
          className="btn-primary"
          onClick={() => window.print()}
        >
          Imprimir / Guardar PDF
        </button>
      </div>
    </div>
  );
}
