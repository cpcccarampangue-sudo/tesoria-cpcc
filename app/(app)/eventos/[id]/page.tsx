import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha } from "@/lib/formatters";
import type { Evento, Movimiento, BalancePorEvento } from "@/lib/types";
import { EventoEditForm } from "./evento-edit-form";

export default async function EventoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const esDirectiva = profile.role === "directiva";

  // Balance del evento (público)
  const { data: balancesData } = await supabase.rpc("api_balance_por_evento");
  const balances = (balancesData as BalancePorEvento[] | null) ?? [];
  const balance = balances.find((b) => b.id === id);
  if (!balance) notFound();

  let evento: Evento | null = null;
  let movimientos: Movimiento[] = [];
  if (esDirectiva) {
    const { data: e } = await supabase
      .from("eventos")
      .select("*")
      .eq("id", id)
      .single();
    evento = (e as Evento | null) ?? null;
    const { data: m } = await supabase
      .from("movimientos")
      .select("*")
      .eq("evento_id", id)
      .order("fecha", { ascending: false });
    movimientos = (m as Movimiento[] | null) ?? [];
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{balance.nombre}</h1>
          <p className="text-sm text-slate-600">
            {formatFecha(balance.fecha)}
            {balance.cerrado && (
              <span className="badge-slate ml-2">Cerrado</span>
            )}
          </p>
        </div>
        {esDirectiva && (
          <Link
            href={`/movimientos/nuevo?evento_id=${id}`}
            className="btn-primary"
          >
            + Movimiento en este evento
          </Link>
        )}
      </div>

      <section className="grid grid-cols-3 gap-4">
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Ingresos</div>
          <div className="text-xl font-semibold text-green-700 mt-1">
            {formatCLP(balance.ingresos)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Egresos</div>
          <div className="text-xl font-semibold text-red-700 mt-1">
            {formatCLP(balance.egresos)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Neto</div>
          <div
            className={`text-xl font-semibold mt-1 ${
              balance.neto >= 0 ? "text-slate-900" : "text-red-700"
            }`}
          >
            {formatCLP(balance.neto)}
          </div>
        </div>
      </section>

      {esDirectiva && evento && (
        <>
          <div className="card">
            <h2 className="font-semibold mb-3">Editar evento</h2>
            <EventoEditForm evento={evento} />
          </div>

          <div>
            <h2 className="font-semibold mb-2">
              Movimientos ({movimientos.length})
            </h2>
            {movimientos.length === 0 ? (
              <div className="card text-sm text-slate-500">
                Este evento aún no tiene movimientos.
              </div>
            ) : (
              <div className="card p-0 overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="table-th">Fecha</th>
                      <th className="table-th">Tipo</th>
                      <th className="table-th text-right">Monto</th>
                      <th className="table-th">Descripción</th>
                      <th className="table-th">Boleta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movimientos.map((m) => (
                      <tr key={m.id}>
                        <td className="table-td">{formatFecha(m.fecha)}</td>
                        <td className="table-td">
                          <span
                            className={
                              m.tipo === "ingreso"
                                ? "badge-green"
                                : "badge-red"
                            }
                          >
                            {m.tipo}
                          </span>
                        </td>
                        <td className="table-td text-right font-semibold">
                          {formatCLP(m.monto)}
                        </td>
                        <td className="table-td">
                          <Link
                            href={`/movimientos/${m.id}`}
                            className="text-brand-700 hover:underline"
                          >
                            {m.descripcion || "(sin descripción)"}
                          </Link>
                        </td>
                        <td className="table-td">
                          {m.boleta_path ? "📎" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
