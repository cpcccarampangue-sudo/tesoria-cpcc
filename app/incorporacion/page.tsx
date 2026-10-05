import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import type { SocioConfig } from "@/lib/types";
import { IncorporacionForm } from "./incorporacion-form";
import { AppFooter } from "@/components/app-footer";

export const metadata = {
  title: "Incorporación de socios — Centro de Padres CPCC",
};
export const dynamic = "force-dynamic";

export default async function IncorporacionPage() {
  const supabase = await createSupabaseServerClient();
  const { data: cfg } = await supabase
    .from("socio_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const config = (cfg as SocioConfig | null) ?? {
    id: 1,
    periodo_anio: new Date().getFullYear(),
    periodo_inicio: null,
    periodo_fin: null,
    monto_cuota: 20000,
    sumup_link: null,
    sumup_checkout_fijo: false,
    cuenta_sumup_id: null,
    categoria_cuota_id: null,
    mensaje_bienvenida: null,
    updated_at: new Date().toISOString(),
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-1 w-full max-w-xl mx-auto px-4 py-8">
        <header className="text-center mb-6">
          <Image
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            width={120}
            height={120}
            className="mx-auto h-24 w-24 object-contain mb-3"
            priority
          />
          <h1 className="text-2xl font-semibold text-slate-900">
            Incorporación de socios {config.periodo_anio}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {INSTITUCION_NOMBRE} — Colegio Carampangue
          </p>
        </header>

        {config.mensaje_bienvenida && (
          <div className="card bg-blue-50 border border-blue-200 text-sm text-blue-900 mb-4">
            {config.mensaje_bienvenida}
          </div>
        )}

        <div className="card">
          <h2 className="font-semibold mb-2">
            Datos del apoderado y alumno
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Llena este formulario para incorporarte como socio del Centro de
            Padres. Después de completar el pago vía SumUp, recibirás por
            correo tu código QR personal que acredita tu condición de socio
            activo del año {config.periodo_anio}.
          </p>
          <IncorporacionForm config={config} />
        </div>

        <div className="card bg-slate-50 text-sm text-slate-600 space-y-2 mt-4">
          <div className="font-semibold text-slate-800">💡 Cómo funciona</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Llenas tus datos y los del alumno.</li>
            <li>Te redirigimos al pago seguro vía SumUp.</li>
            <li>
              Al confirmarse el pago, recibes en tu correo un código QR único
              que acredita que eres socio activo del año {config.periodo_anio}.
            </li>
            <li>
              Puedes mostrar ese QR en reuniones, eventos y convenios con
              comercios locales para acceder a beneficios de socios.
            </li>
          </ol>
          <p className="text-xs text-slate-500 pt-2 border-t border-slate-200 mt-2">
            Monto de la cuota anual:{" "}
            <strong>${config.monto_cuota.toLocaleString("es-CL")}</strong>
          </p>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
