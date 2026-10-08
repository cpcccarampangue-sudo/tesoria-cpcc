import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig } from "@/lib/types";
import { precioVigente } from "@/lib/socios/precio";
import { IncorporacionForm } from "./incorporacion-form";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";

export const metadata = {
  title: "Incorporación de socios — Centro de Padres CPCC",
};
export const dynamic = "force-dynamic";

const PASOS = [
  { nombre: "Identificación", clave: "ident" },
  { nombre: "Datos", clave: "datos" },
  { nombre: "Pago", clave: "pago" },
  { nombre: "Credencial", clave: "cred" },
];

// La pagina publica siempre arranca en el paso 1 (Identificación). Los
// pasos 2-4 avanzan en el cliente al confirmar/pagar, pero esto se maneja
// dentro del formulario. Aqui marcamos siempre el 1 como activo para
// que el timeline refleje donde empieza el usuario.
const PASO_ACTIVO = 0;

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
    monto_cuota_normal: 20000,
    monto_cuota_promocional: null,
    promocion_inicio: null,
    promocion_fin: null,
    sumup_link: null,
    sumup_link_promo: null,
    sumup_link_normal: null,
    sumup_checkout_fijo: false,
    cuenta_sumup_id: null,
    categoria_cuota_id: null,
    mensaje_bienvenida: null,
    cpcc_instagram_url: null,
    cpcc_whatsapp_url: null,
    cpcc_convenios_url: null,
    correo_bienvenida_asunto: null,
    correo_bienvenida_cuerpo: null,
    correo_renovacion_asunto: null,
    correo_renovacion_cuerpo: null,
    updated_at: new Date().toISOString(),
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA]">
      <PublicHeader
        activa="incorporacion"
        badge={`SOCIOS ${config.periodo_anio}`}
      />

      {/* Hero */}
      <section className="w-full">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-4 text-center sm:text-left">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight"
            style={{ color: "#1e3a8a" }}
          >
            Incorpórate al Centro de Padres
          </h1>
          <p className="text-sm sm:text-base text-slate-600 mt-2 max-w-xl">
            Completa tus datos, realiza el pago y recibe tu credencial digital
            de socio.
          </p>
        </div>

        {/* Timeline */}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
          <ol className="flex items-start gap-2 text-[11px] sm:text-xs">
            {PASOS.map((p, i) => {
              const activo = i === PASO_ACTIVO;
              const futuro = i > PASO_ACTIVO;
              return (
                <li
                  key={p.clave}
                  className="flex-1 flex items-center gap-2 min-w-0"
                >
                  <span
                    aria-current={activo ? "step" : undefined}
                    className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                      activo
                        ? "bg-brand-700 text-white"
                        : futuro
                        ? "bg-slate-200 text-slate-500"
                        : "bg-slate-300 text-white"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`truncate ${
                      activo
                        ? "text-slate-900 font-medium"
                        : "text-slate-500"
                    }`}
                  >
                    {p.nombre}
                  </span>
                  {i < PASOS.length - 1 && (
                    <span
                      className="hidden sm:block flex-1 h-px bg-slate-200"
                      aria-hidden="true"
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Contenido */}
      <div className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 pb-8">
        {config.mensaje_bienvenida && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-900 p-3 mb-4">
            {config.mensaje_bienvenida}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-brand-700"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                Encuentra tu familia
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ingresa el correo electrónico registrado en el colegio.
              </p>
            </div>
          </div>

          <IncorporacionForm config={config} />
        </div>

        {/* Cómo funciona */}
        <section id="ayuda" className="mt-8 scroll-mt-24">
          <h2 className="text-base font-semibold text-slate-900">
            ¿Cómo funciona?
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            En 4 pasos te incorporas como socio del Centro de Padres.
          </p>
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <HelpBlock
              num="01"
              titulo="Datos"
              texto="Completa o confirma la información del apoderado y alumno."
            />
            <HelpBlock
              num="02"
              titulo="Pago"
              texto="Realiza el pago en línea mediante SumUp."
            />
            <HelpBlock
              num="03"
              titulo="Confirmación"
              texto="Validamos el pago automáticamente."
            />
            <HelpBlock
              num="04"
              titulo="Credencial"
              texto={`Recibes tu QR personal de socio ${config.periodo_anio}.`}
            />
          </ol>

          <p className="mt-4 text-xs text-slate-500 flex items-center gap-1.5">
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
            Conexión segura. Cuota $
            {precioVigente(config).toLocaleString("es-CL")} CLP por familia.
          </p>
        </section>
      </div>

      <PublicFooter />
    </div>
  );
}

function HelpBlock({
  num,
  titulo,
  texto,
}: {
  num: string;
  titulo: string;
  texto: string;
}) {
  return (
    <li className="rounded-xl bg-white border border-slate-200 p-4">
      <div
        className="text-[11px] font-semibold tracking-widest"
        style={{ color: "#F08C00" }}
      >
        {num}
      </div>
      <div className="text-sm font-semibold text-slate-900 mt-0.5">
        {titulo}
      </div>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{texto}</p>
    </li>
  );
}
