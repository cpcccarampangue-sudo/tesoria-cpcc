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

const PASOS = [
  "Identificación",
  "Confirmación",
  "Pago",
  "Credencial",
];

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
    <div className="min-h-screen flex flex-col bg-[#F7F8FA]">
      {/* ================================================================
          HEADER institucional compacto (siempre visible, centrado)
          ================================================================ */}
      <header className="w-full bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            width={56}
            height={56}
            className="h-12 w-12 object-contain flex-shrink-0"
            priority
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "#1e3a8a" }}
            >
              {INSTITUCION_NOMBRE}
            </p>
            <h1 className="text-base sm:text-lg font-semibold text-slate-900 leading-tight">
              Colegio Carampangue
            </h1>
          </div>
          <span
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold tracking-wide text-white"
            style={{ background: "#F08C00" }}
          >
            SOCIOS {config.periodo_anio}
          </span>
        </div>
      </header>

      {/* ================================================================
          HERO
          ================================================================ */}
      <section className="w-full">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-4 text-center sm:text-left">
          <h2
            className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight"
            style={{ color: "#1e3a8a" }}
          >
            Incorpórate al Centro de Padres
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-2 max-w-xl">
            Completa tu incorporación como socio del período{" "}
            <strong>{config.periodo_anio}</strong>. Es un proceso breve y
            seguro.
          </p>
        </div>

        {/* Indicador de pasos */}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          <ol className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
            {PASOS.map((p, i) => (
              <li
                key={p}
                className="flex-1 flex items-center gap-2 min-w-0"
              >
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                    i === 0
                      ? "bg-brand-700 text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`truncate ${
                    i === 0 ? "text-slate-900 font-medium" : "text-slate-500"
                  }`}
                >
                  {p}
                </span>
                {i < PASOS.length - 1 && (
                  <span className="hidden sm:block flex-1 h-px bg-slate-200" />
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ================================================================
          CONTENIDO
          ================================================================ */}
      <div className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 pb-10">
        {config.mensaje_bienvenida && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-900 p-3 mb-4">
            {config.mensaje_bienvenida}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
          <IncorporacionForm config={config} />
        </div>

        {/* Cómo funciona */}
        <div className="mt-5">
          <details className="group bg-white rounded-xl border border-slate-200 overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 flex items-center justify-between list-none select-none [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-medium text-slate-700">
                ¿Cómo funciona?
              </span>
              <svg
                className="w-4 h-4 text-slate-400 transition-transform duration-200 group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </summary>
            <div className="px-4 pb-4 text-sm text-slate-600 space-y-2 border-t border-slate-100 pt-3">
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>Nos indicas el correo con que te registraste.</li>
                <li>
                  Te mostramos los datos parciales de tu familia para que
                  confirmes.
                </li>
                <li>Pagas la cuota a través de SumUp.</li>
                <li>
                  Recibes por correo tu <strong>credencial QR</strong>{" "}
                  que acredita tu condición de socio activo del año{" "}
                  {config.periodo_anio}.
                </li>
              </ol>
              <p className="pt-2 text-xs text-slate-500 border-t border-slate-100">
                Protegemos tus datos: nunca mostramos información completa
                en el formulario público ni permitimos buscar por nombre,
                apellido o alumno.
              </p>
            </div>
          </details>
        </div>

        {/* Confianza */}
        <p className="mt-5 text-xs text-slate-500 text-center flex items-center justify-center gap-1.5">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          Conexión segura. Cuota ${config.monto_cuota.toLocaleString("es-CL")}{" "}
          CLP por familia.
        </p>
      </div>

      <AppFooter />
    </div>
  );
}
