import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Cartola } from "@/lib/types";
import { CartolasTabla } from "./cartolas-tabla";
import { AvancePorCuenta } from "./avance-por-cuenta";

export const metadata = { title: "Cartolas — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CartolaRow = Cartola & {
  cuenta: { id: string; nombre: string; color: string | null } | null;
};

export type AvanceCartola = {
  cartola_id: string;
  total: number;
  conciliadas: number;
  pendientes: number;
};

export default async function CartolasPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const [{ data: cartolasData }, { data: avanceData }] = await Promise.all([
    supabase
      .from("cartolas")
      .select("*, cuenta:cuenta_id(id,nombre,color)")
      .order("fecha_fin", { ascending: false, nullsFirst: false })
      .order("subida_en", { ascending: false })
      .limit(500),
    supabase
      .from("v_conciliacion_por_cartola")
      .select("cartola_id, total, conciliadas, pendientes"),
  ]);

  const cartolas = (cartolasData as unknown as CartolaRow[] | null) ?? [];
  const avances = (avanceData as AvanceCartola[] | null) ?? [];
  const avancesPorId = new Map(avances.map((a) => [a.cartola_id, a]));

  const cuentasUnicas = Array.from(
    new Map(
      cartolas
        .filter((c) => c.cuenta)
        .map((c) => [c.cuenta!.id, c.cuenta!])
    ).values()
  );

  // Resumen agregado por cuenta: sumatoria de conciliadas y totales.
  const resumenPorCuenta = cuentasUnicas.map((cta) => {
    const cartolasDeCta = cartolas.filter((c) => c.cuenta?.id === cta.id);
    let total = 0;
    let conciliadas = 0;
    for (const c of cartolasDeCta) {
      const a = avancesPorId.get(c.id);
      if (a) {
        total += a.total;
        conciliadas += a.conciliadas;
      }
    }
    return {
      cuenta: cta,
      total,
      conciliadas,
      pendientes: total - conciliadas,
    };
  });

  return (
    <div className="space-y-4">
      {resumenPorCuenta.some((r) => r.total > 0) && (
        <AvancePorCuenta resumen={resumenPorCuenta} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cartolas bancarias</h1>
          <p className="text-sm text-slate-600">
            Sube el Excel de la cartola de cada cuenta. El sistema parsea las
            líneas y las deja disponibles para reconciliar contra los
            movimientos registrados.
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
        <CartolasTabla
          cartolas={cartolas}
          cuentas={cuentasUnicas}
          avancesPorId={Object.fromEntries(avancesPorId)}
        />
      )}
    </div>
  );
}
