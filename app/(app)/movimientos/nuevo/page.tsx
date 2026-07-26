import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MovimientoForm } from "../movimiento-form";

export const metadata = { title: "Nuevo movimiento — Tesorería CPCC" };

export default async function NuevoMovimientoPage({
  searchParams,
}: {
  searchParams: Promise<{ evento_id?: string; tipo?: string }>;
}) {
  await requireDirectiva();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: categorias }, { data: eventos }] = await Promise.all([
    supabase
      .from("categorias")
      .select("id, nombre, tipo, activa")
      .eq("activa", true)
      .order("nombre"),
    supabase
      .from("eventos")
      .select("id, nombre")
      .eq("cerrado", false)
      .order("nombre"),
  ]);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Nuevo movimiento</h1>
      <div className="card">
        <MovimientoForm
          categorias={categorias ?? []}
          eventos={eventos ?? []}
          initialTipo={params.tipo === "egreso" ? "egreso" : "ingreso"}
          initialEventoId={params.evento_id ?? null}
        />
      </div>
    </div>
  );
}
