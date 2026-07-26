import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Categoria } from "@/lib/types";
import { NuevaCategoria } from "./nueva-categoria";
import { CategoriaRow } from "./categoria-row";

export const metadata = { title: "Categorías — Tesorería CPCC" };

export default async function CategoriasPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categorias")
    .select("*")
    .order("tipo")
    .order("nombre");
  const categorias = (data as Categoria[] | null) ?? [];
  const ingresos = categorias.filter((c) => c.tipo === "ingreso");
  const egresos = categorias.filter((c) => c.tipo === "egreso");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Categorías</h1>
        <p className="text-sm text-slate-600">
          Organiza los movimientos con categorías (ej: cuota apoderado,
          materiales, rifas).
        </p>
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Nueva categoría</h2>
        <NuevaCategoria />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-3 text-green-800">
            Ingresos ({ingresos.length})
          </h3>
          <ul className="divide-y divide-slate-100">
            {ingresos.map((c) => (
              <CategoriaRow key={c.id} c={c} />
            ))}
            {ingresos.length === 0 && (
              <li className="py-2 text-sm text-slate-500">
                Sin categorías de ingreso.
              </li>
            )}
          </ul>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3 text-red-800">
            Egresos ({egresos.length})
          </h3>
          <ul className="divide-y divide-slate-100">
            {egresos.map((c) => (
              <CategoriaRow key={c.id} c={c} />
            ))}
            {egresos.length === 0 && (
              <li className="py-2 text-sm text-slate-500">
                Sin categorías de egreso.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
