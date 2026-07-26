import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFechaHora } from "@/lib/formatters";
import type { Movimiento } from "@/lib/types";
import { MovimientoForm } from "../movimiento-form";
import { BoletaLink } from "./boleta-link";
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

  const [{ data: categorias }, { data: eventos }] = await Promise.all([
    supabase
      .from("categorias")
      .select("id, nombre, tipo, activa")
      .eq("activa", true)
      .order("nombre"),
    supabase
      .from("eventos")
      .select("id, nombre")
      .order("nombre"),
  ]);

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
        {m.boleta_path && <BoletaLink path={m.boleta_path} />}
      </div>

      <div className="card">
        <MovimientoForm
          categorias={categorias ?? []}
          eventos={eventos ?? []}
          initial={{
            id: m.id,
            fecha: m.fecha,
            tipo: m.tipo,
            monto: m.monto,
            descripcion: m.descripcion,
            categoria_id: m.categoria_id,
            evento_id: m.evento_id,
            boleta_path: m.boleta_path,
          }}
        />
      </div>

      <div className="text-right">
        <DeleteBtn id={m.id} />
      </div>
    </div>
  );
}
