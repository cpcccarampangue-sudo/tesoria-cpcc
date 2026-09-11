// Panel de resumen del avance de reconciliacion por cuenta. Se renderiza
// arriba de la tabla de cartolas para dar contexto de un vistazo.

type ResumenCuenta = {
  cuenta: { id: string; nombre: string; color: string | null };
  total: number;
  conciliadas: number;
  pendientes: number;
};

function formatPct(conciliadas: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((conciliadas / total) * 100)}%`;
}

export function AvancePorCuenta({ resumen }: { resumen: ResumenCuenta[] }) {
  const totalGlobal = resumen.reduce((a, r) => a + r.total, 0);
  const conciliadasGlobal = resumen.reduce((a, r) => a + r.conciliadas, 0);
  const pctGlobal = totalGlobal > 0
    ? Math.round((conciliadasGlobal / totalGlobal) * 100)
    : 0;

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-semibold">
          Avance de reconciliación
        </h2>
        <div className="text-sm text-slate-600">
          Total: <strong>{conciliadasGlobal}</strong> de{" "}
          <strong>{totalGlobal}</strong> líneas ({pctGlobal}%)
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {resumen.map((r) => {
          const pct = r.total > 0 ? (r.conciliadas / r.total) * 100 : 0;
          const color = r.cuenta.color ?? "#94a3b8";
          return (
            <div
              key={r.cuenta.id}
              className="rounded-md border border-slate-200 p-3"
            >
              <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                {r.cuenta.nombre}
              </div>
              <div className="mt-1 font-semibold text-slate-900">
                {r.conciliadas} / {r.total}{" "}
                <span className="text-slate-500 font-normal text-sm">
                  ({formatPct(r.conciliadas, r.total)})
                </span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {r.pendientes === 0
                  ? "Reconciliación completa"
                  : `${r.pendientes} línea(s) pendiente(s)`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
