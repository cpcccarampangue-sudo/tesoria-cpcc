import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaCargo } from "@/lib/types";
import { CertificadoForm } from "./certificado-form";

export const metadata = { title: "Certificados — Tesorería CPCC" };
export const dynamic = "force-dynamic";

export default async function CertificadosPage() {
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
        <h1 className="text-2xl font-semibold">Generar certificado</h1>
        <p className="text-sm text-slate-600 mt-1">
          Genera un certificado imprimible en cualquier momento. Elige una
          plantilla rápida o parte en blanco y escribe el certificado que
          necesites.
        </p>
      </div>

      <div className="card">
        <CertificadoForm cargosActivos={cargosActivos} />
      </div>

      <div className="card bg-slate-50 text-sm text-slate-600 space-y-2">
        <div className="font-semibold text-slate-800">💡 Cómo se usa</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Plantillas rápidas</strong>: al elegir una, se rellenan
            automáticamente el subtítulo y el cuerpo con un texto sugerido.
            Puedes editar todo antes de imprimir.
          </li>
          <li>
            <strong>Placeholders</strong> en el cuerpo (
            <code>{"{{nombre}}"}</code>, <code>{"{{rut}}"}</code>,{" "}
            <code>{"{{fecha}}"}</code>, <code>{"{{monto}}"}</code>,{" "}
            <code>{"{{institucion}}"}</code>): se reemplazan por los valores
            que llenaste al momento de imprimir. Si el dato queda vacío,
            aparece una línea en blanco para llenar a mano.
          </li>
          <li>
            El certificado se abre en una ventana nueva lista para imprimir o
            guardar como PDF. <strong>No queda guardado</strong> en el
            sistema.
          </li>
        </ul>
      </div>
    </div>
  );
}
