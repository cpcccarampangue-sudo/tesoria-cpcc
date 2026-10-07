import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { NuevoConvenioForm } from "./nuevo-form";

export const metadata = { title: "Nuevo convenio — Tesorería CPCC" };
export const dynamic = "force-dynamic";

export default async function NuevoConvenioPage() {
  await requireDirectiva();
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <Link
          href="/convenios"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Volver a convenios
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">
        Nuevo convenio
      </h1>
      <p className="text-sm text-slate-600">
        Crea el convenio con sus datos básicos. Después agregarás los
        correos autorizados a validar en su nombre.
      </p>
      <div className="card">
        <NuevoConvenioForm />
      </div>
    </div>
  );
}
