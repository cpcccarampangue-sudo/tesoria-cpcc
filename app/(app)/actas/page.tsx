import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaCargo } from "@/lib/types";
import { ActaForm } from "./acta-form";

export const metadata = { title: "Actas — Tesorería CPCC" };
export const dynamic = "force-dynamic";

export default async function ActasPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: directivaActiva } = await supabase
    .from("directiva_miembros")
    .select("cargo")
    .eq("activo", true);
  const cargosActivos = (
    (directivaActiva as { cargo: DirectivaCargo }[] | null) ?? []
  ).map((d) => d.cargo);

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Generar acta de recibo</h1>
        <p className="text-sm text-slate-600 mt-1">
          Genera un acta imprimible en cualquier momento, sin necesidad de que
          exista un movimiento asociado. Sirve para dejar constancia de una
          entrega o recepción de dineros del Centro de Padres.
        </p>
      </div>

      <div className="card">
        <ActaForm cargosActivos={cargosActivos} />
      </div>

      <div className="card bg-slate-50 text-sm text-slate-600 space-y-2">
        <div className="font-semibold text-slate-800">💡 Cómo se usa</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>El CdP entrega plata</strong>: uso típico — pago a
            proveedor, premio, reembolso. La persona que recibe firma
            &quot;recibe conforme&quot; y la directiva firma como quien entrega.
          </li>
          <li>
            <strong>El CdP recibe plata</strong>: aportes, donaciones,
            cobros en efectivo. La directiva declara haber recibido y firma;
            la persona que entrega puede firmar como constancia.
          </li>
          <li>
            El acta se abre en una ventana nueva lista para imprimir o
            guardar como PDF. <strong>No queda guardada</strong> en el
            sistema — es un documento generado al momento.
          </li>
        </ul>
      </div>
    </div>
  );
}
