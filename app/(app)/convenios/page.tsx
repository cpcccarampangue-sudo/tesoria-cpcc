import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { listarConvenios } from "./actions";

export const metadata = { title: "Convenios — Tesorería CPCC" };
export const dynamic = "force-dynamic";

export default async function ConveniosPage() {
  await requireDirectiva();
  const convenios = await listarConvenios();

  const activos = convenios.filter((c) => c.active);
  const inactivos = convenios.filter((c) => !c.active);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Convenios</h1>
          <p className="text-sm text-slate-600 mt-1">
            Comercios y servicios con beneficios para socios. Cada convenio
            puede tener uno o varios correos autorizados a validar en
            /validar.
          </p>
        </div>
        <Link href="/convenios/nuevo" className="btn-primary">
          + Nuevo convenio
        </Link>
      </header>

      {convenios.length === 0 ? (
        <div className="card text-sm text-slate-600 text-center py-12">
          Aún no hay convenios registrados.
          <div className="mt-3">
            <Link href="/convenios/nuevo" className="btn-primary">
              Crear el primero
            </Link>
          </div>
        </div>
      ) : (
        <>
          <SeccionConvenios titulo="Activos" items={activos} />
          {inactivos.length > 0 && (
            <SeccionConvenios titulo="Inactivos" items={inactivos} />
          )}
        </>
      )}
    </div>
  );
}

function SeccionConvenios({
  titulo,
  items,
}: {
  titulo: string;
  items: Array<{
    id: string;
    nombre: string;
    logo_url: string | null;
    valid_from: string | null;
    valid_until: string | null;
    active: boolean;
    operadoresActivos: number;
  }>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">
        {titulo} ({items.length})
      </h2>
      <div className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Convenio</th>
              <th className="text-left px-3 py-2 font-medium">Vigencia</th>
              <th className="text-right px-3 py-2 font-medium">Operadores</th>
              <th className="text-right px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr
                key={c.id}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/convenios/${c.id}`}
                    className="flex items-center gap-3 min-w-0"
                  >
                    {c.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logo_url}
                        alt=""
                        className="w-8 h-8 rounded object-contain bg-slate-100 flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-xs text-slate-400 flex-shrink-0">
                        —
                      </div>
                    )}
                    <span className="font-medium text-slate-900 hover:underline truncate">
                      {c.nombre}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {c.valid_from || c.valid_until
                    ? `${c.valid_from ?? "—"} → ${c.valid_until ?? "—"}`
                    : "sin vigencia definida"}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.operadoresActivos}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.active ? (
                    <span className="badge-green">activo</span>
                  ) : (
                    <span className="badge-slate">inactivo</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
