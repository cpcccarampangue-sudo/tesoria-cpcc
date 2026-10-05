import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig } from "@/lib/types";
import { NuevoSocioForm } from "./nuevo-form";

export const metadata = {
  title: "Nuevo socio con pago manual — Tesorería CPCC",
};
export const dynamic = "force-dynamic";

type CuentaOp = { id: string; nombre: string; es_principal: boolean };

export default async function NuevoSocioPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const [{ data: cfgData }, { data: cuentasData }] = await Promise.all([
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("cuentas")
      .select("id, nombre, es_principal")
      .eq("activa", true)
      .order("orden")
      .order("nombre"),
  ]);
  const config = cfgData as SocioConfig | null;
  const cuentas = (cuentasData as CuentaOp[] | null) ?? [];

  if (!config) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Nuevo socio con pago manual</h1>
        <div className="card bg-amber-50 border border-amber-200 text-sm text-amber-900">
          El sistema de socios no está configurado. Ve a{" "}
          <Link href="/socios/config" className="underline">
            /socios/config
          </Link>{" "}
          para definir período y monto antes de incorporar socios.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <Link
          href="/socios"
          className="text-sm text-slate-600 hover:underline"
        >
          ← Volver a socios
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">
          Incorporar socio con pago manual
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Usa esto cuando recibes el pago en una reunión u otro contexto
          fuera del formulario público. Se crea la solicitud, se registra el
          pago en el libro de caja y la familia queda marcada como socia
          activa del año {config.periodo_anio}.
        </p>
      </div>

      <div className="card">
        <NuevoSocioForm config={config} cuentas={cuentas} />
      </div>
    </div>
  );
}
