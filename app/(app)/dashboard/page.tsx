import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha } from "@/lib/formatters";
import type {
  BalanceGeneral,
  BalancePorEvento,
  CuotaEstadoApoderado,
} from "@/lib/types";
import Link from "next/link";

export const metadata = { title: "Inicio — Tesorería CPCC" };

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const esDirectiva = profile.role === "directiva";

  // Balance general — todos lo ven (agregado, no expone filas)
  const { data: balanceData } = await supabase.rpc("api_balance_general");
  const balance = (balanceData?.[0] as BalanceGeneral | undefined) ?? {
    total_ingresos: 0,
    total_egresos: 0,
    saldo: 0,
  };

  // Balance por evento — todos lo ven
  const { data: eventosBalanceData } = await supabase.rpc(
    "api_balance_por_evento"
  );
  const eventosBalance =
    (eventosBalanceData as BalancePorEvento[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Hola{profile.nombre ? `, ${profile.nombre}` : ""}
        </h1>
        <p className="text-sm text-slate-600">
          {esDirectiva
            ? "Panel de control de la tesorería."
            : "Bienvenido/a al portal del Centro de Padres."}
        </p>
      </div>

      {/* KPIs generales */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Saldo del centro
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-1">
            {formatCLP(balance.saldo)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Total ingresos
          </div>
          <div className="text-2xl font-semibold text-green-700 mt-1">
            {formatCLP(balance.total_ingresos)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Total egresos
          </div>
          <div className="text-2xl font-semibold text-red-700 mt-1">
            {formatCLP(balance.total_egresos)}
          </div>
        </div>
      </section>

      {/* Contenido específico por rol */}
      {esDirectiva ? (
        <DirectivaPanel />
      ) : (
        <ApoderadoPanel apoderadoId={profile.apoderado_id} />
      )}

      {/* Balance por evento (visible a todos) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Balance por evento
          </h2>
          <Link
            href="/eventos"
            className="text-sm text-brand-600 hover:underline"
          >
            Ver todos →
          </Link>
        </div>
        {eventosBalance.length === 0 ? (
          <div className="card text-sm text-slate-500">
            Todavía no hay eventos registrados.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="table-th">Evento</th>
                  <th className="table-th">Fecha</th>
                  <th className="table-th text-right">Ingresos</th>
                  <th className="table-th text-right">Egresos</th>
                  <th className="table-th text-right">Neto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {eventosBalance.map((e) => (
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
                        e.nombre
                      )}
                      {e.cerrado && (
                        <span className="badge-slate ml-2">cerrado</span>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

async function DirectivaPanel() {
  const supabase = await createSupabaseServerClient();

  const { count: apoderadosCount } = await supabase
    .from("apoderados")
    .select("*", { count: "exact", head: true })
    .eq("activo", true);

  const { count: movimientosCount } = await supabase
    .from("movimientos")
    .select("*", { count: "exact", head: true });

  const { data: ultimos } = await supabase
    .from("movimientos")
    .select("id, fecha, tipo, monto, descripcion")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: pagosPendientes } = await supabase
    .from("v_cuota_estado_apoderado")
    .select("apoderado_id, nombre, periodo, monto_periodo, pagado, estado")
    .neq("estado", "pagada")
    .neq("estado", "exenta")
    .limit(5);

  return (
    <>
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Apoderados activos
          </div>
          <div className="text-2xl font-semibold mt-1">
            {apoderadosCount ?? 0}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500 font-medium">
            Movimientos registrados
          </div>
          <div className="text-2xl font-semibold mt-1">
            {movimientosCount ?? 0}
          </div>
        </div>
        <div className="card col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase text-slate-500 font-medium">
              Acciones rápidas
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Link href="/movimientos/nuevo" className="btn-primary text-xs">
              + Registrar movimiento
            </Link>
            <Link href="/eventos/nuevo" className="btn-secondary text-xs">
              + Nuevo evento
            </Link>
            <Link href="/cuotas" className="btn-secondary text-xs">
              Cobrar cuotas
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">
              Últimos movimientos
            </h3>
            <Link
              href="/movimientos"
              className="text-sm text-brand-600 hover:underline"
            >
              Ver todos →
            </Link>
          </div>
          {!ultimos || ultimos.length === 0 ? (
            <p className="text-sm text-slate-500">
              Sin movimientos registrados aún.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ultimos.map((m) => (
                <li
                  key={m.id}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m.descripcion || "(sin descripción)"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatFecha(m.fecha)}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold whitespace-nowrap ${
                      m.tipo === "ingreso" ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {m.tipo === "ingreso" ? "+" : "−"}
                    {formatCLP(m.monto)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">
              Cuotas pendientes
            </h3>
            <Link
              href="/cuotas"
              className="text-sm text-brand-600 hover:underline"
            >
              Ver matriz →
            </Link>
          </div>
          {!pagosPendientes || pagosPendientes.length === 0 ? (
            <p className="text-sm text-slate-500">
              No hay cuotas pendientes. 🎉
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pagosPendientes.map((p, i) => (
                <li key={i} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{p.nombre}</div>
                      <div className="text-xs text-slate-500">
                        {p.periodo}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-700">
                        {formatCLP(p.monto_periodo - Number(p.pagado))}
                      </div>
                      <div className="text-xs text-amber-700 capitalize">
                        {p.estado}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

async function ApoderadoPanel({
  apoderadoId,
}: {
  apoderadoId: string | null;
}) {
  if (!apoderadoId) {
    return (
      <div className="card bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-900">
          Tu cuenta aún no está vinculada a un apoderado registrado. Por favor
          contacta a la directiva del Centro de Padres para que te agregue con
          este correo electrónico.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: cuotas } = await supabase
    .from("v_cuota_estado_apoderado")
    .select("*")
    .eq("apoderado_id", apoderadoId);

  const misCuotas = (cuotas as CuotaEstadoApoderado[] | null) ?? [];
  const totalPendiente = misCuotas
    .filter((c) => c.estado !== "pagada" && c.estado !== "exenta")
    .reduce((s, c) => s + (Number(c.monto_periodo) - Number(c.pagado)), 0);

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900 mb-3">Tus cuotas</h2>
      {misCuotas.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay períodos de cuota activos.
        </div>
      ) : (
        <div className="space-y-3">
          {totalPendiente > 0 && (
            <div className="card bg-amber-50 border border-amber-200">
              <p className="text-sm text-amber-900">
                Tienes un saldo pendiente de{" "}
                <strong>{formatCLP(totalPendiente)}</strong>.
              </p>
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="table-th">Período</th>
                  <th className="table-th text-right">Monto</th>
                  <th className="table-th text-right">Pagado</th>
                  <th className="table-th">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {misCuotas.map((c) => (
                  <tr key={c.periodo_id}>
                    <td className="table-td font-medium">{c.periodo}</td>
                    <td className="table-td text-right">
                      {formatCLP(c.monto_periodo)}
                    </td>
                    <td className="table-td text-right">
                      {formatCLP(c.pagado)}
                    </td>
                    <td className="table-td">
                      <EstadoBadge estado={c.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    pagada: "badge-green",
    parcial: "badge-amber",
    pendiente: "badge-red",
    exenta: "badge-slate",
  };
  return (
    <span className={map[estado] ?? "badge-slate"}>
      {estado.charAt(0).toUpperCase() + estado.slice(1)}
    </span>
  );
}
