import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha } from "@/lib/formatters";
import type { BalancePorEvento } from "@/lib/types";

export const metadata = { title: "Eventos — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EventosPage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const esDirectiva = profile.role === "directiva";

  const { data } = await supabase.rpc("api_balance_por_evento");
  const eventos = (data as BalancePorEvento[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Eventos</h1>
          <p className="text-sm text-slate-600">
            Balance de cada actividad (bingo, rifa, kermesse, etc.).
          </p>
        </div>
        {esDirectiva && (
          <Link href="/eventos/nuevo" className="btn-primary">
            + Nuevo evento
          </Link>
        )}
      </div>

      {eventos.length === 0 ? (
        <div className="card text-sm text-slate-500">
          Todavía no hay eventos registrados.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Evento</th>
                <th className="table-th">Fecha</th>
                <th className="table-th text-right">Ingresos</th>
                <th className="table-th text-right">Egresos</th>
                <th className="table-th text-right">Neto</th>
                <th className="table-th">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {eventos.map((e) => (
                <tr key={e.id}>
                  <td className="table-td font-medium">
                    {esDirectiva ? (
                      <Link
                        href={`/eventos/${e.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {e.nombre}
                      </Link>
                    ) : (
                      <Link
                        href={`/eventos/${e.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {e.nombre}
                      </Link>
                    )}
                  </td>
                  <td className="table-td">{formatFecha(e.fecha)}</td>
                  <td className="table-td text-right text-green-700">
                    {formatCLP(e.ingresos)}
                  </td>
                  <td className="table-td text-right text-red-700">
                    {formatCLP(e.egresos)}
                  </td>
                  <td
                    className={`table-td text-right font-semibold ${
                      e.neto >= 0 ? "text-slate-900" : "text-red-700"
                    }`}
                  >
                    {formatCLP(e.neto)}
                  </td>
                  <td className="table-td">
                    {e.cerrado ? (
                      <span className="badge-slate">Cerrado</span>
                    ) : (
                      <span className="badge-green">Abierto</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
