import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP } from "@/lib/formatters";
import type { CuotaEstadoApoderado, CuotaPeriodo } from "@/lib/types";
import { PagoDialog } from "./pago-dialog";

export const metadata = { title: "Cuotas — Tesorería CPCC" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CuotasPage() {
  const profile = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const esDirectiva = profile.role === "directiva";

  const { data: periodos } = await supabase
    .from("cuota_periodos")
    .select("id, nombre, monto, fecha_vencimiento, activa, created_at")
    .eq("activa", true)
    .order("created_at", { ascending: false });

  let filas: CuotaEstadoApoderado[] = [];
  let pagosMap: Record<
    string,
    { id: string; nota: string | null; cuenta_id: string | null }
  > = {};
  let cuentasActivas: {
    id: string;
    nombre: string;
    es_principal: boolean;
  }[] = [];

  if (esDirectiva) {
    const { data } = await supabase
      .from("v_cuota_estado_apoderado")
      .select("*")
      .order("nombre");
    filas = (data as CuotaEstadoApoderado[] | null) ?? [];

    // Cargar IDs de pagos (para editar) + cuenta_id del movimiento asociado.
    const { data: pagos } = await supabase
      .from("cuota_pagos")
      .select("id, periodo_id, apoderado_id, nota");
    const pagoIds = (pagos ?? []).map((p) => p.id);
    const { data: movsAsociados } = pagoIds.length
      ? await supabase
          .from("movimientos")
          .select("cuota_pago_id, cuenta_id")
          .in("cuota_pago_id", pagoIds)
      : { data: [] as { cuota_pago_id: string; cuenta_id: string }[] };
    const cuentaPorPago = new Map<string, string>();
    for (const m of movsAsociados ?? []) {
      if (m.cuota_pago_id) cuentaPorPago.set(m.cuota_pago_id, m.cuenta_id);
    }
    for (const p of pagos ?? []) {
      pagosMap[`${p.periodo_id}:${p.apoderado_id}`] = {
        id: p.id,
        nota: p.nota,
        cuenta_id: cuentaPorPago.get(p.id) ?? null,
      };
    }

    const { data: cuentas } = await supabase
      .from("cuentas")
      .select("id, nombre, es_principal")
      .eq("activa", true)
      .order("orden")
      .order("nombre");
    cuentasActivas = cuentas ?? [];
  } else if (profile.apoderado_id) {
    const { data } = await supabase
      .from("v_cuota_estado_apoderado")
      .select("*")
      .eq("apoderado_id", profile.apoderado_id);
    filas = (data as CuotaEstadoApoderado[] | null) ?? [];
  }

  if (!esDirectiva) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Mis cuotas</h1>
        {filas.length === 0 ? (
          <div className="card text-sm text-slate-500">
            No hay períodos activos o tu cuenta no está vinculada a un
            apoderado.
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-th">Período</th>
                  <th className="table-th text-right">Monto</th>
                  <th className="table-th text-right">Pagado</th>
                  <th className="table-th text-right">Saldo</th>
                  <th className="table-th">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((f) => (
                  <tr key={f.periodo_id}>
                    <td className="table-td font-medium">{f.periodo}</td>
                    <td className="table-td text-right">
                      {formatCLP(f.monto_periodo)}
                    </td>
                    <td className="table-td text-right">
                      {formatCLP(f.pagado)}
                    </td>
                    <td className="table-td text-right">
                      {formatCLP(f.monto_periodo - Number(f.pagado))}
                    </td>
                    <td className="table-td">
                      <EstadoBadge estado={f.estado} />
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

  // Vista directiva: matriz
  const periodosArr = (periodos as CuotaPeriodo[] | null) ?? [];

  // Agrupar por apoderado
  const porApoderado = new Map<
    string,
    { nombre: string; curso: string | null; celdas: CuotaEstadoApoderado[] }
  >();
  for (const f of filas) {
    if (!porApoderado.has(f.apoderado_id)) {
      porApoderado.set(f.apoderado_id, {
        nombre: f.nombre,
        curso: f.curso,
        celdas: [],
      });
    }
    porApoderado.get(f.apoderado_id)!.celdas.push(f);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cuotas</h1>
          <p className="text-sm text-slate-600">
            Matriz de apoderados × períodos activos. Haz clic en una celda para
            registrar un pago.
          </p>
        </div>
        <Link href="/cuotas/periodos" className="btn-secondary">
          Períodos
        </Link>
      </div>

      {periodosArr.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay períodos activos.{" "}
          <Link href="/cuotas/periodos" className="text-brand-700 underline">
            Crea el primero
          </Link>
          .
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th sticky left-0 bg-slate-50">
                  Apoderado
                </th>
                <th className="table-th">Curso</th>
                {periodosArr.map((p) => (
                  <th key={p.id} className="table-th text-right">
                    {p.nombre}
                    <div className="text-[10px] font-normal text-slate-400">
                      {formatCLP(p.monto)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Array.from(porApoderado.entries()).map(([apoId, info]) => (
                <tr key={apoId}>
                  <td className="table-td font-medium sticky left-0 bg-white">
                    {info.nombre}
                  </td>
                  <td className="table-td">{info.curso ?? "—"}</td>
                  {periodosArr.map((p) => {
                    const celda = info.celdas.find(
                      (c) => c.periodo_id === p.id
                    );
                    if (!celda) {
                      return (
                        <td key={p.id} className="table-td text-right">
                          —
                        </td>
                      );
                    }
                    const pagoInfo = pagosMap[`${p.id}:${apoId}`];
                    return (
                      <td key={p.id} className="table-td text-right">
                        {pagoInfo && (
                          <PagoDialog
                            pagoId={pagoInfo.id}
                            apoderadoNombre={info.nombre}
                            periodoNombre={p.nombre}
                            montoPeriodo={p.monto}
                            montoActual={Number(celda.pagado)}
                            estadoActual={celda.estado}
                            notaActual={pagoInfo.nota}
                            cuentas={cuentasActivas}
                            cuentaIdActual={pagoInfo.cuenta_id}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {porApoderado.size === 0 && (
                <tr>
                  <td
                    className="table-td text-slate-500"
                    colSpan={2 + periodosArr.length}
                  >
                    No hay apoderados activos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
