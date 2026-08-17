import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha, formatFechaHora } from "@/lib/formatters";
import type { Cartola } from "@/lib/types";

export const metadata = { title: "Cartolas — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CartolaRow = Cartola & {
  cuenta: { id: string; nombre: string; color: string | null } | null;
};

export default async function CartolasPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("cartolas")
    .select("*, cuenta:cuenta_id(id,nombre,color)")
    .order("fecha_fin", { ascending: false, nullsFirst: false })
    .order("subida_en", { ascending: false })
    .limit(200);

  const cartolas = (data as unknown as CartolaRow[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cartolas bancarias</h1>
          <p className="text-sm text-slate-600">
            Sube el Excel de la cartola de cada cuenta. El sistema parsea las
            líneas y las deja disponibles para reconciliar contra los
            movimientos registrados (próxima fase).
          </p>
        </div>
        <Link href="/cartolas/nueva" className="btn-primary">
          + Subir cartola
        </Link>
      </div>

      {cartolas.length === 0 ? (
        <div className="card text-sm text-slate-500">
          Aún no hay cartolas subidas.{" "}
          <Link href="/cartolas/nueva" className="text-brand-700 underline">
            Sube la primera
          </Link>
          .
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Cuenta</th>
                <th className="table-th">Período</th>
                <th className="table-th text-right">Líneas</th>
                <th className="table-th text-right">Saldo inicial</th>
                <th className="table-th text-right">Saldo final</th>
                <th className="table-th">Subida</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cartolas.map((c) => (
                <tr key={c.id}>
                  <td className="table-td">
                    {c.cuenta ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: c.cuenta.color ?? "#94a3b8",
                          }}
                          aria-hidden
                        />
                        {c.cuenta.nombre}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="table-td text-sm">
                    {c.fecha_inicio && c.fecha_fin
                      ? c.fecha_inicio === c.fecha_fin
                        ? formatFecha(c.fecha_inicio)
                        : `${formatFecha(c.fecha_inicio)} → ${formatFecha(c.fecha_fin)}`
                      : "—"}
                  </td>
                  <td className="table-td text-right font-semibold">
                    {c.filas_total}
                  </td>
                  <td className="table-td text-right text-sm text-slate-600">
                    {c.saldo_inicial != null ? formatCLP(c.saldo_inicial) : "—"}
                  </td>
                  <td className="table-td text-right text-sm text-slate-600">
                    {c.saldo_final != null ? formatCLP(c.saldo_final) : "—"}
                  </td>
                  <td className="table-td text-xs text-slate-500">
                    {formatFechaHora(c.subida_en)}
                  </td>
                  <td className="table-td text-right">
                    <Link
                      href={`/cartolas/${c.id}`}
                      className="text-brand-700 hover:underline text-sm"
                    >
                      Ver
                    </Link>
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
