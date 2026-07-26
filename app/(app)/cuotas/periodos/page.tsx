import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha } from "@/lib/formatters";
import type { CuotaPeriodo } from "@/lib/types";
import { PeriodoForm } from "./periodo-form";
import { PeriodoRow } from "./periodo-row";

export const metadata = { title: "Períodos de cuota — Tesorería CPCC" };

export default async function PeriodosPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: periodos } = await supabase
    .from("cuota_periodos")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Períodos de cuota</h1>
        <p className="text-sm text-slate-600">
          Define los períodos de cobro (ej: cuota anual, cuota mensual). Al
          crear un período, se generan las filas de pago para todos los
          apoderados activos.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Nuevo período</h2>
        <PeriodoForm />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Nombre</th>
              <th className="table-th text-right">Monto</th>
              <th className="table-th">Vencimiento</th>
              <th className="table-th">Estado</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(periodos as CuotaPeriodo[] | null ?? []).map((p) => (
              <PeriodoRow
                key={p.id}
                p={p}
                montoLabel={formatCLP(p.monto)}
                vencLabel={formatFecha(p.fecha_vencimiento)}
              />
            ))}
            {(!periodos || periodos.length === 0) && (
              <tr>
                <td colSpan={5} className="table-td text-slate-500">
                  Sin períodos definidos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
