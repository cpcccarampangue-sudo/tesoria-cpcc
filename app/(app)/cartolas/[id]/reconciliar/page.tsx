import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatFecha } from "@/lib/formatters";
import type { Cartola } from "@/lib/types";
import { analizarReconciliacion } from "./actions";
import { ReconciliarClient } from "./reconciliar-client";

export const metadata = { title: "Reconciliar cartola — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CartolaRow = Cartola & {
  cuenta: { id: string; nombre: string; color: string | null } | null;
};

export default async function ReconciliarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: cart } = await supabase
    .from("cartolas")
    .select("*, cuenta:cuenta_id(id,nombre,color)")
    .eq("id", id)
    .maybeSingle();
  if (!cart) notFound();
  const cartola = cart as unknown as CartolaRow;

  // Conciliaciones ya existentes para las lineas de esta cartola.
  const { data: yaConciliadas } = await supabase
    .from("conciliaciones")
    .select(
      "id, cartola_linea_id, movimiento_id, auto, ajuste_glosa, cartola_lineas!inner(cartola_id, fecha, descripcion, monto, tipo), movimientos!inner(fecha, descripcion, monto, tipo, es_transferencia)"
    )
    .eq("cartola_lineas.cartola_id", id);

  const conciliadas = (yaConciliadas ?? []) as unknown as Array<{
    id: string;
    cartola_linea_id: string;
    movimiento_id: string;
    auto: boolean;
    ajuste_glosa: string | null;
    cartola_lineas: {
      cartola_id: string;
      fecha: string;
      descripcion: string;
      monto: number;
      tipo: "ingreso" | "egreso";
    };
    movimientos: {
      fecha: string;
      descripcion: string | null;
      monto: number;
      tipo: "ingreso" | "egreso";
      es_transferencia: boolean;
    };
  }>;

  // Analizar las lineas restantes (no conciliadas).
  const analisis = await analizarReconciliacion(id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/cartolas/${id}`}
          className="text-sm text-slate-600 hover:underline"
        >
          ← Volver a la cartola
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Reconciliar cartola</h1>
        <p className="text-sm text-slate-600">
          {cartola.cuenta?.nombre} · Período{" "}
          {cartola.fecha_inicio && cartola.fecha_fin
            ? cartola.fecha_inicio === cartola.fecha_fin
              ? formatFecha(cartola.fecha_inicio)
              : `${formatFecha(cartola.fecha_inicio)} → ${formatFecha(
                  cartola.fecha_fin
                )}`
            : "—"}
        </p>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Total líneas</div>
          <div className="text-2xl font-semibold mt-1">
            {cartola.filas_total}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">
            Ya conciliadas
          </div>
          <div className="text-2xl font-semibold text-green-700 mt-1">
            {conciliadas.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">
            Match automático
          </div>
          <div className="text-2xl font-semibold text-blue-700 mt-1">
            {analisis.resultado.exactos.length}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Sin match</div>
          <div className="text-2xl font-semibold text-amber-700 mt-1">
            {analisis.resultado.sin_match_ids.length}
          </div>
        </div>
      </section>

      <ReconciliarClient
        cartolaId={id}
        resultado={analisis.resultado}
        lineasIndex={analisis.lineasIndex}
        movsIndex={analisis.movsIndex}
        yaConciliadas={conciliadas.map((c) => ({
          id: c.id,
          linea: {
            id: c.cartola_linea_id,
            fecha: c.cartola_lineas.fecha,
            descripcion: c.cartola_lineas.descripcion,
            monto: Number(c.cartola_lineas.monto),
            tipo: c.cartola_lineas.tipo,
          },
          movimiento: {
            id: c.movimiento_id,
            fecha: c.movimientos.fecha,
            descripcion: c.movimientos.descripcion,
            monto: Number(c.movimientos.monto),
            tipo: c.movimientos.tipo,
            es_transferencia: c.movimientos.es_transferencia,
          },
          auto: c.auto,
          ajuste_glosa: c.ajuste_glosa,
        }))}
      />
    </div>
  );
}
