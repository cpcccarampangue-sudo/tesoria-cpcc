import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Cartola } from "@/lib/types";
import { CartolasTabla } from "./cartolas-tabla";

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
    .limit(500);

  const cartolas = (data as unknown as CartolaRow[] | null) ?? [];

  const cuentasUnicas = Array.from(
    new Map(
      cartolas
        .filter((c) => c.cuenta)
        .map((c) => [c.cuenta!.id, c.cuenta!])
    ).values()
  );

  return (
    <div className="space-y-4">
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
        <CartolasTabla cartolas={cartolas} cuentas={cuentasUnicas} />
      )}
    </div>
  );
}
