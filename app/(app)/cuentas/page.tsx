import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BalancePorCuenta, Cuenta } from "@/lib/types";
import { NuevaCuenta } from "./nueva-cuenta";
import { CuentaRow } from "./cuenta-row";

export const metadata = { title: "Cuentas — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CuentasPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const [{ data: cuentasData }, { data: balanceData }] = await Promise.all([
    supabase.from("cuentas").select("*").order("orden").order("nombre"),
    supabase.from("v_balance_por_cuenta").select("*"),
  ]);

  const cuentas = (cuentasData as Cuenta[] | null) ?? [];
  const balances = (balanceData as BalancePorCuenta[] | null) ?? [];
  const balanceById = new Map(balances.map((b) => [b.id, b]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cuentas</h1>
        <p className="text-sm text-slate-600">
          Cada movimiento pertenece a una cuenta. Estas son las 3 ubicaciones
          donde vive la plata del Centro de Padres: la cuenta del banco a
          nombre del CdP, la del tesorero y la caja chica.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Nueva cuenta</h2>
        <NuevaCuenta />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Nombre</th>
              <th className="table-th">Tipo</th>
              <th className="table-th">Titular</th>
              <th className="table-th text-right">Movimientos</th>
              <th className="table-th text-right">Saldo</th>
              <th className="table-th text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cuentas.map((c) => (
              <CuentaRow
                key={c.id}
                cuenta={c}
                balance={balanceById.get(c.id) ?? null}
              />
            ))}
            {cuentas.length === 0 && (
              <tr>
                <td
                  className="table-td text-sm text-slate-500 text-center"
                  colSpan={6}
                >
                  Aún no hay cuentas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
