import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaMiembro } from "@/lib/types";
import { DIRECTIVA_CARGO_LABEL, DIRECTIVA_CARGO_ORDEN } from "@/lib/types";
import { NuevoMiembro } from "./nuevo-miembro";
import { MiembroRow } from "./miembro-row";

export const metadata = { title: "Directiva — Tesorería CPCC" };

export default async function DirectivaPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("directiva_miembros")
    .select("*")
    .order("activo", { ascending: false })
    .order("orden")
    .order("nombre");
  const miembros = (data as DirectivaMiembro[] | null) ?? [];

  // Cargos activos actuales, para el resumen arriba.
  const activosPorCargo = new Map<string, DirectivaMiembro>();
  for (const m of miembros) {
    if (m.activo) activosPorCargo.set(m.cargo, m);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Directiva del CdP</h1>
        <p className="text-sm text-slate-600">
          Personas que firman las actas y comprobantes oficiales. Cada cargo
          tiene una sola persona activa a la vez; al marcar a alguien nuevo se
          desactiva automáticamente al anterior.
        </p>
      </div>

      {/* Resumen: cargos vigentes */}
      <div className="card">
        <h2 className="font-semibold mb-2">Cargos vigentes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          {DIRECTIVA_CARGO_ORDEN.map((c) => {
            const m = activosPorCargo.get(c);
            return (
              <div
                key={c}
                className="rounded border border-slate-200 p-2"
              >
                <div className="text-xs uppercase text-slate-500">
                  {DIRECTIVA_CARGO_LABEL[c]}
                </div>
                {m ? (
                  <>
                    <div className="font-medium">{m.nombre}</div>
                    <div className="font-mono text-xs text-slate-600">
                      {m.rut}
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs italic">
                    Sin asignar
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Agregar miembro</h2>
        <NuevoMiembro />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="table-th">Nombre</th>
              <th className="table-th">RUT</th>
              <th className="table-th">Cargo</th>
              <th className="table-th">Estado</th>
              <th className="table-th text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {miembros.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  Aún no hay miembros registrados.
                </td>
              </tr>
            ) : (
              miembros.map((m) => <MiembroRow key={m.id} m={m} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
