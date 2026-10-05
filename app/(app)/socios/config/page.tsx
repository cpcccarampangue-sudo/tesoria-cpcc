import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig } from "@/lib/types";
import { ConfigForm } from "./config-form";

export const metadata = { title: "Configuración de socios — Tesorería CPCC" };
export const dynamic = "force-dynamic";

export default async function SocioConfigPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("socio_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const config = (data as SocioConfig | null) ?? {
    id: 1,
    periodo_anio: new Date().getFullYear(),
    periodo_inicio: null,
    periodo_fin: null,
    monto_cuota: 20000,
    sumup_link: null,
    sumup_checkout_fijo: false,
    mensaje_bienvenida: null,
    updated_at: new Date().toISOString(),
  };

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
        <h1 className="text-2xl font-semibold">Configuración del módulo</h1>
        <p className="text-sm text-slate-600 mt-1">
          Edita el año activo, el monto de la cuota, el link de pago SumUp y
          el mensaje que ven los apoderados en el formulario público.
        </p>
      </div>
      <div className="card">
        <ConfigForm config={config} />
      </div>
    </div>
  );
}
