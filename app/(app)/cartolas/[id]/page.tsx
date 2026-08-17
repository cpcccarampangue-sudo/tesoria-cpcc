import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha, formatFechaHora } from "@/lib/formatters";
import type { Cartola, CartolaLinea } from "@/lib/types";
import { CartolaHeaderActions } from "./actions-btn";

export const metadata = { title: "Cartola — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CartolaRow = Cartola & {
  cuenta: { id: string; nombre: string; color: string | null } | null;
};

export default async function CartolaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevas?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: cart } = await supabase
    .from("cartolas")
    .select("*, cuenta:cuenta_id(id,nombre,color)")
    .eq("id", id)
    .maybeSingle();
  if (!cart) notFound();
  const cartola = cart as unknown as CartolaRow;

  const { data: lineasData } = await supabase
    .from("cartola_lineas")
    .select("*")
    .eq("cartola_id", id)
    .order("fecha", { ascending: true })
    .order("fila_num", { ascending: true });
  const lineas = (lineasData as CartolaLinea[] | null) ?? [];

  const totales = lineas.reduce(
    (acc, l) => {
      if (l.tipo === "ingreso") acc.ing += Number(l.monto);
      else acc.egr += Number(l.monto);
      return acc;
    },
    { ing: 0, egr: 0 }
  );

  const nuevasParam = Number(sp.nuevas ?? "");
  const showJustImported =
    !Number.isNaN(nuevasParam) && nuevasParam === cartola.filas_total;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/cartolas"
          className="text-sm text-slate-600 hover:underline"
        >
          ← Cartolas
        </Link>
      </div>

      {showJustImported && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
          <strong>Cartola importada:</strong> {cartola.filas_total} línea(s)
          parseada(s). Aún no se han cruzado con los movimientos de la app —
          eso lo hará la próxima fase de reconciliación.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Cartola{" "}
            {cartola.cuenta ? (
              <span className="inline-flex items-center gap-1.5 text-lg">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: cartola.cuenta.color ?? "#94a3b8",
                  }}
                  aria-hidden
                />
                {cartola.cuenta.nombre}
              </span>
            ) : (
              "—"
            )}
          </h1>
          <p className="text-sm text-slate-600">
            Período:{" "}
            {cartola.fecha_inicio && cartola.fecha_fin
              ? cartola.fecha_inicio === cartola.fecha_fin
                ? formatFecha(cartola.fecha_inicio)
                : `${formatFecha(cartola.fecha_inicio)} → ${formatFecha(
                    cartola.fecha_fin
                  )}`
              : "—"}{" "}
            · Subida {formatFechaHora(cartola.subida_en)}
          </p>
        </div>
        <CartolaHeaderActions
          cartolaId={cartola.id}
          archivoPath={cartola.archivo_path}
          archivoNombre={cartola.archivo_nombre}
        />
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Líneas
          </div>
          <div className="text-2xl font-semibold mt-1">
            {cartola.filas_total}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Abonos (ingresos)
          </div>
          <div className="text-xl font-semibold text-green-700 mt-1">
            {formatCLP(totales.ing)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Cargos (egresos)
          </div>
          <div className="text-xl font-semibold text-red-700 mt-1">
            {formatCLP(totales.egr)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Saldo del banco
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {cartola.saldo_inicial != null
              ? formatCLP(cartola.saldo_inicial)
              : "—"}{" "}
            →{" "}
            <strong className="text-slate-900">
              {cartola.saldo_final != null
                ? formatCLP(cartola.saldo_final)
                : "—"}
            </strong>
          </div>
        </div>
      </section>

      {lineas.length === 0 ? (
        <div className="card text-sm text-slate-500">
          La cartola no tiene líneas parseadas.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Fecha</th>
                <th className="table-th">Descripción</th>
                <th className="table-th">Canal / Ref.</th>
                <th className="table-th text-right">Monto</th>
                <th className="table-th text-right">Saldo</th>
                <th className="table-th">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lineas.map((l) => (
                <tr key={l.id}>
                  <td className="table-td">{formatFecha(l.fecha)}</td>
                  <td className="table-td max-w-md truncate">
                    {l.descripcion}
                  </td>
                  <td className="table-td text-xs text-slate-500">
                    {l.canal ?? l.referencia_externa ?? "—"}
                  </td>
                  <td
                    className={`table-td text-right font-semibold ${
                      l.tipo === "ingreso" ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {l.tipo === "ingreso" ? "+" : "−"}
                    {formatCLP(l.monto)}
                  </td>
                  <td className="table-td text-right text-xs text-slate-500">
                    {l.saldo_despues != null ? formatCLP(l.saldo_despues) : "—"}
                  </td>
                  <td className="table-td">
                    {l.conciliado ? (
                      <span className="badge-green text-xs">conciliada</span>
                    ) : (
                      <span className="badge-slate text-xs">sin cruzar</span>
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
