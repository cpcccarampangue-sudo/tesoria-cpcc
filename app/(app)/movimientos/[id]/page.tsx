import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFecha, formatFechaHora } from "@/lib/formatters";
import type { Movimiento, MovimientoAdjunto } from "@/lib/types";
import { AdjuntosManager } from "@/components/adjuntos-manager";
import { MovimientoForm } from "../movimiento-form";
import { DeleteBtn } from "./delete-btn";

export default async function MovimientoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("movimientos")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const m = data as Movimiento;

  const [{ data: categorias }, { data: eventos }, { data: cuentas }] =
    await Promise.all([
      supabase
        .from("categorias")
        .select("id, nombre, tipo, activa")
        .eq("activa", true)
        .order("nombre"),
      supabase
        .from("eventos")
        .select("id, nombre")
        .order("nombre"),
      supabase
        .from("cuentas")
        .select("id, nombre, color, es_principal, activa")
        .order("orden")
        .order("nombre"),
    ]);
  const cuentasVisibles = (cuentas ?? []).filter(
    (c) => c.activa || c.id === m.cuenta_id
  );

  const { data: adjuntosData } = await supabase
    .from("movimiento_adjuntos")
    .select("*")
    .eq("movimiento_id", m.id)
    .order("subido_en", { ascending: true });
  const adjuntos = (adjuntosData as MovimientoAdjunto[] | null) ?? [];

  // Para transferencias internas cargamos la contraparte para mostrarla en solo-lectura.
  type Contraparte = {
    id: string;
    tipo: string;
    monto: number;
    cuenta: { nombre: string; color: string | null } | null;
  };
  let contraparte: Contraparte | null = null;
  if (m.es_transferencia && m.transferencia_par_id) {
    const { data: par } = await supabase
      .from("movimientos")
      .select("id, tipo, monto, cuenta:cuenta_id(nombre, color)")
      .eq("id", m.transferencia_par_id)
      .maybeSingle();
    contraparte = (par as unknown as Contraparte | null) ?? null;
  }

  if (m.es_transferencia) {
    // Vista simplificada: transferencias no se editan (borrar y recrear).
    const cuentaEste = cuentasVisibles.find((c) => c.id === m.cuenta_id);
    return (
      <div className="max-w-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <span className="badge-slate">↔ transferencia</span>
              <span>{formatCLP(m.monto)}</span>
            </h1>
            <p className="text-xs text-slate-500">
              Creado {formatFechaHora(m.created_at)}
            </p>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3">
            Este movimiento es una transferencia interna entre cuentas. Para
            corregir algún dato, elimínalo (se borran los dos lados a la vez)
            y créalo de nuevo desde{" "}
            <Link
              href="/movimientos/transferencia/nueva"
              className="underline font-medium"
            >
              Nueva transferencia
            </Link>
            .
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-slate-500">Fecha</dt>
              <dd className="font-medium">{formatFecha(m.fecha)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Monto</dt>
              <dd className="font-medium">{formatCLP(m.monto)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">
                Esta línea ({m.tipo})
              </dt>
              <dd className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: cuentaEste?.color ?? "#94a3b8" }}
                  aria-hidden
                />
                {cuentaEste?.nombre ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">
                Contraparte ({contraparte?.tipo ?? "—"})
              </dt>
              <dd className="flex items-center gap-1.5">
                {contraparte ? (
                  <>
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: contraparte.cuenta?.color ?? "#94a3b8",
                      }}
                      aria-hidden
                    />
                    <Link
                      href={`/movimientos/${contraparte.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {contraparte.cuenta?.nombre ?? "—"}
                    </Link>
                  </>
                ) : (
                  <span className="text-slate-500">
                    Sin contraparte (posiblemente eliminada)
                  </span>
                )}
              </dd>
            </div>
            {m.descripcion && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase text-slate-500">
                  Descripción
                </dt>
                <dd>{m.descripcion}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card">
          <h2 className="font-semibold mb-3">Adjuntos ({adjuntos.length})</h2>
          <p className="text-xs text-slate-500 mb-3">
            Los adjuntos que agregues aquí se asocian solo a este lado. Para
            adjuntar el comprobante de la transferencia electrónica, usa
            preferentemente el lado del banco que recibió la plata.
          </p>
          <AdjuntosManager
            mode="persisted"
            movimientoId={m.id}
            initial={adjuntos}
            uploadPrefix={m.id}
          />
        </div>

        <div className="text-right">
          <DeleteBtn id={m.id} esTransferencia />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Movimiento{" "}
            <span
              className={
                m.tipo === "ingreso" ? "text-green-700" : "text-red-700"
              }
            >
              {formatCLP(m.monto)}
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Creado {formatFechaHora(m.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/movimientos/nuevo?tipo=${m.tipo}${
              m.evento_id ? `&evento_id=${m.evento_id}` : ""
            }`}
            className="btn-secondary"
          >
            + Agregar otro
          </Link>
        </div>
      </div>

      <div className="card">
        <MovimientoForm
          categorias={categorias ?? []}
          eventos={eventos ?? []}
          cuentas={cuentasVisibles}
          initial={{
            id: m.id,
            fecha: m.fecha,
            tipo: m.tipo,
            monto: m.monto,
            descripcion: m.descripcion,
            categoria_id: m.categoria_id,
            evento_id: m.evento_id,
            cuenta_id: m.cuenta_id,
          }}
        />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Adjuntos ({adjuntos.length})</h2>
        <p className="text-xs text-slate-500 mb-3">
          Puedes adjuntar múltiples archivos: boleta, comprobante de pago,
          cotización, contrato, foto, etc. Cada uno con su tipo y descripción.
        </p>
        <AdjuntosManager
          mode="persisted"
          movimientoId={m.id}
          initial={adjuntos}
          uploadPrefix={m.id}
        />
      </div>

      <div className="text-right">
        <DeleteBtn id={m.id} />
      </div>
    </div>
  );
}
