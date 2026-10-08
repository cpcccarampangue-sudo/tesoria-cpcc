import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { obtenerConvenio } from "../actions";
import { ConvenioDetalleForm } from "./detalle-form";

export const dynamic = "force-dynamic";

export default async function ConvenioDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDirectiva();
  const { id } = await params;
  const convenio = await obtenerConvenio(id);
  if (!convenio) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <Link
          href="/convenios"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Volver a convenios
        </Link>
      </div>

      <header className="flex items-start gap-4">
        {convenio.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={convenio.logo_url}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="w-14 h-14 rounded-xl object-contain bg-slate-100 flex-shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0">
            —
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-slate-900 min-w-0">
              {convenio.nombre}
            </h1>
            {convenio.active ? (
              <span className="badge-green">activo</span>
            ) : (
              <span className="badge-slate">inactivo</span>
            )}
          </div>
          {convenio.descripcion && (
            <p className="text-sm text-slate-600 mt-1">
              {convenio.descripcion}
            </p>
          )}
        </div>
      </header>

      <ConvenioDetalleForm convenio={convenio} />
    </div>
  );
}
