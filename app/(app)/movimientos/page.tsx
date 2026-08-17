import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha } from "@/lib/formatters";
import { MovimientosFilters } from "./movimientos-filters";

export const metadata = { title: "Movimientos — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

type MovimientoRow = {
  id: string;
  fecha: string;
  tipo: "ingreso" | "egreso";
  monto: number;
  descripcion: string | null;
  boleta_path: string | null;
  es_transferencia: boolean;
  categoria: { nombre: string } | null;
  evento: { id: string; nombre: string } | null;
  cuenta: { id: string; nombre: string; color: string | null } | null;
};

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{
    tipo?: string;
    evento_id?: string;
    categoria_id?: string;
    cuenta_id?: string;
    desde?: string;
    hasta?: string;
    solo_transferencias?: string;
  }>;
}) {
  await requireDirectiva();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from("movimientos")
    .select(
      "id, fecha, tipo, monto, descripcion, boleta_path, es_transferencia, categoria:categoria_id(nombre), evento:evento_id(id,nombre), cuenta:cuenta_id(id,nombre,color)"
    )
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (params.tipo === "ingreso" || params.tipo === "egreso") {
    q = q.eq("tipo", params.tipo);
  }
  if (params.evento_id) q = q.eq("evento_id", params.evento_id);
  if (params.categoria_id) q = q.eq("categoria_id", params.categoria_id);
  if (params.cuenta_id) q = q.eq("cuenta_id", params.cuenta_id);
  if (params.desde) q = q.gte("fecha", params.desde);
  if (params.hasta) q = q.lte("fecha", params.hasta);
  if (params.solo_transferencias === "1") q = q.eq("es_transferencia", true);

  const { data } = await q;
  const movimientos = (data as unknown as MovimientoRow[] | null) ?? [];

  // Totales EXCLUYEN transferencias internas (no son plata que entra/sale del CdP).
  const total = movimientos.reduce(
    (acc, m) => {
      if (m.es_transferencia) return acc;
      if (m.tipo === "ingreso") acc.ing += Number(m.monto);
      else acc.egr += Number(m.monto);
      return acc;
    },
    { ing: 0, egr: 0 }
  );

  const [{ data: eventos }, { data: categorias }, { data: cuentas }] =
    await Promise.all([
      supabase.from("eventos").select("id, nombre").order("nombre"),
      supabase.from("categorias").select("id, nombre").order("nombre"),
      supabase
        .from("cuentas")
        .select("id, nombre")
        .order("orden")
        .order("nombre"),
    ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Movimientos</h1>
          <p className="text-sm text-slate-600">
            {movimientos.length} movimiento(s) — Ingresos:{" "}
            <span className="text-green-700 font-semibold">
              {formatCLP(total.ing)}
            </span>{" "}
            · Egresos:{" "}
            <span className="text-red-700 font-semibold">
              {formatCLP(total.egr)}
            </span>{" "}
            · Neto:{" "}
            <span className="font-semibold">
              {formatCLP(total.ing - total.egr)}
            </span>
            <span className="text-xs text-slate-500 block sm:inline sm:ml-2">
              (transferencias internas excluidas)
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/movimientos/transferencia/nueva"
            className="btn-secondary"
          >
            ↔ Nueva transferencia
          </Link>
          <Link href="/movimientos/nuevo" className="btn-primary">
            + Nuevo movimiento
          </Link>
        </div>
      </div>

      <div className="card">
        <MovimientosFilters
          eventos={eventos ?? []}
          categorias={categorias ?? []}
          cuentas={cuentas ?? []}
        />
      </div>

      {movimientos.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay movimientos que coincidan.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Fecha</th>
                <th className="table-th">Tipo</th>
                <th className="table-th text-right">Monto</th>
                <th className="table-th">Cuenta</th>
                <th className="table-th">Categoría</th>
                <th className="table-th">Evento</th>
                <th className="table-th">Descripción</th>
                <th className="table-th">Boleta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movimientos.map((m) => (
                <tr key={m.id} className={m.es_transferencia ? "bg-slate-50/50" : ""}>
                  <td className="table-td">{formatFecha(m.fecha)}</td>
                  <td className="table-td">
                    {m.es_transferencia ? (
                      <span
                        className="badge-slate"
                        title="Transferencia interna entre cuentas"
                      >
                        ↔ transf.
                      </span>
                    ) : (
                      <span
                        className={
                          m.tipo === "ingreso" ? "badge-green" : "badge-red"
                        }
                      >
                        {m.tipo}
                      </span>
                    )}
                  </td>
                  <td
                    className={`table-td text-right font-semibold ${
                      m.es_transferencia
                        ? "text-slate-600"
                        : m.tipo === "ingreso"
                        ? "text-green-700"
                        : "text-red-700"
                    }`}
                  >
                    {m.tipo === "ingreso" ? "+" : "−"}
                    {formatCLP(m.monto)}
                  </td>
                  <td className="table-td">
                    {m.cuenta ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: m.cuenta.color ?? "#94a3b8",
                          }}
                          aria-hidden
                        />
                        {m.cuenta.nombre}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="table-td">{m.categoria?.nombre ?? "—"}</td>
                  <td className="table-td">
                    {m.evento ? (
                      <Link
                        href={`/eventos/${m.evento.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {m.evento.nombre}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="table-td max-w-xs truncate">
                    <Link
                      href={`/movimientos/${m.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {m.descripcion || "(sin descripción)"}
                    </Link>
                  </td>
                  <td className="table-td">{m.boleta_path ? "📎" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
