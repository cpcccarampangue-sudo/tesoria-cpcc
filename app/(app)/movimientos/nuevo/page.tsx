import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MovimientoForm } from "../movimiento-form";

export const metadata = { title: "Nuevo movimiento — Tesorería CPCC" };

export default async function NuevoMovimientoPage({
  searchParams,
}: {
  searchParams: Promise<{ evento_id?: string; tipo?: string; cuenta_id?: string }>;
}) {
  await requireDirectiva();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

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
        .eq("cerrado", false)
        .order("nombre"),
      supabase
        .from("cuentas")
        .select("id, nombre, color, es_principal, activa")
        .eq("activa", true)
        .order("orden")
        .order("nombre"),
    ]);

  const cuentasActivas = cuentas ?? [];
  const principal = cuentasActivas.find((c) => c.es_principal);
  const initialCuentaId =
    params.cuenta_id ?? principal?.id ?? cuentasActivas[0]?.id ?? "";

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Nuevo movimiento</h1>
      <div className="card">
        <MovimientoForm
          categorias={categorias ?? []}
          eventos={eventos ?? []}
          cuentas={cuentasActivas}
          initialTipo={params.tipo === "egreso" ? "egreso" : "ingreso"}
          initialEventoId={params.evento_id ?? null}
          initialCuentaId={initialCuentaId}
        />
      </div>
    </div>
  );
}
