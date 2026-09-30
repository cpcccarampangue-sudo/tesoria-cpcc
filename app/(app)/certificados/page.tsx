import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaCargo } from "@/lib/types";
import { CertificadoForm } from "./certificado-form";

export const metadata = { title: "Certificados — Tesorería CPCC" };
export const dynamic = "force-dynamic";

const CARGOS_VALIDOS: DirectivaCargo[] = [
  "presidente",
  "vicepresidente",
  "tesorero",
  "protesorero",
  "secretario",
  "director",
];

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function parseFirmantes(
  raw: string | string[] | undefined
): DirectivaCargo[] | undefined {
  const value = firstParam(raw);
  if (!value) return undefined;
  const cargos = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DirectivaCargo =>
      CARGOS_VALIDOS.includes(s as DirectivaCargo)
    );
  return cargos.length > 0 ? cargos : undefined;
}

export default async function CertificadosPage({
  searchParams,
}: {
  searchParams: Promise<{
    titulo?: string;
    subtitulo?: string;
    cuerpo?: string;
    nombre?: string;
    rut?: string;
    fecha?: string;
    monto?: string;
    curso?: string;
    firmantes?: string | string[];
  }>;
}) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const sp = await searchParams;

  const { data: directivaActiva } = await supabase
    .from("directiva_miembros")
    .select("cargo")
    .eq("activo", true);
  const cargosActivos = (
    (directivaActiva as { cargo: DirectivaCargo }[] | null) ?? []
  ).map((d) => d.cargo);

  const prellenado = !!sp.cuerpo || !!sp.titulo;

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

      {prellenado && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
          El formulario viene <strong>prellenado</strong> con los datos del
          certificado anterior. Ajusta lo que necesites y presiona{" "}
          <strong>Generar certificado</strong> otra vez.
        </div>
      )}

      <div className="card">
        <CertificadoForm
          cargosActivos={cargosActivos}
          tituloInicial={firstParam(sp.titulo)}
          subtituloInicial={firstParam(sp.subtitulo)}
          cuerpoInicial={firstParam(sp.cuerpo)}
          nombreInicial={firstParam(sp.nombre)}
          rutInicial={firstParam(sp.rut)}
          fechaInicial={firstParam(sp.fecha)}
          montoInicial={firstParam(sp.monto)}
          cursoInicial={firstParam(sp.curso)}
          firmantesIniciales={parseFirmantes(sp.firmantes)}
        />
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
