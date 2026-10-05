import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { AppFooter } from "@/components/app-footer";

export const metadata = { title: "Verificación de socio — CPCC" };
export const dynamic = "force-dynamic";

export default async function SocioPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: solData }, { data: cfgData }] = await Promise.all([
    supabase
      .from("socio_solicitudes")
      .select("*")
      .eq("qr_token", token)
      .maybeSingle(),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  const solicitud = solData as SocioSolicitud | null;
  const config = cfgData as SocioConfig | null;

  // Reglas de validez:
  //  - La solicitud existe
  //  - Estado es "enviada" (QR ya emitido)
  //  - El periodo coincide con el periodo vigente de la config
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();
  const activo =
    !!solicitud &&
    solicitud.estado === "enviada" &&
    solicitud.periodo_anio === periodoVigente;

  // Posibles estados "no activo" para dar mensaje mas util
  const motivoRechazo = !solicitud
    ? "Este QR no corresponde a ningún socio registrado."
    : solicitud.estado === "pendiente_pago"
    ? "Este socio aún no completa el pago de su cuota."
    : solicitud.estado === "pagada"
    ? "El pago está confirmado pero aún no se ha emitido el QR definitivo. Intenta de nuevo en unos minutos."
    : solicitud.estado === "rechazada" || solicitud.estado === "anulada"
    ? "Esta inscripción fue dada de baja."
    : solicitud.periodo_anio !== periodoVigente
    ? `Este QR corresponde al periodo ${solicitud.periodo_anio} y ya no está vigente. El periodo activo es ${periodoVigente}.`
    : "QR no vigente.";

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-1 w-full max-w-md mx-auto px-4 py-8 flex flex-col justify-center">
        <header className="text-center mb-4">
          <Image
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            width={120}
            height={120}
            className="mx-auto h-20 w-20 object-contain mb-2"
            priority
          />
          <h1 className="text-base font-semibold text-slate-900">
            Verificación de socio
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {INSTITUCION_NOMBRE} — Colegio Carampangue
          </p>
        </header>

        {activo && solicitud ? (
          <div className="card border-2 border-green-500 bg-green-50 text-center space-y-3">
            <div className="text-6xl">✅</div>
            <div className="text-xl font-bold text-green-900">
              Socio activo {solicitud.periodo_anio}
            </div>
            <div className="pt-3 border-t border-green-200 space-y-1 text-sm text-slate-800">
              <div>
                <span className="text-xs uppercase text-slate-500">
                  Familia
                </span>
                <div className="font-semibold">
                  {solicitud.apoderado_nombre}
                </div>
              </div>
              <div>
                <span className="text-xs uppercase text-slate-500">
                  Alumno
                </span>
                <div className="font-medium">
                  {solicitud.alumno_nombre}
                </div>
              </div>
              <div>
                <span className="text-xs uppercase text-slate-500">Curso</span>
                <div className="font-medium">{solicitud.curso}</div>
              </div>
            </div>
            <p className="text-xs text-green-800 pt-2 border-t border-green-200">
              Cuota {solicitud.periodo_anio} pagada el{" "}
              {solicitud.pagada_en
                ? new Date(solicitud.pagada_en).toLocaleDateString("es-CL")
                : "—"}
            </p>
          </div>
        ) : (
          <div className="card border-2 border-red-400 bg-red-50 text-center space-y-3">
            <div className="text-6xl">❌</div>
            <div className="text-xl font-bold text-red-900">
              QR no válido
            </div>
            <p className="text-sm text-red-800">{motivoRechazo}</p>
            {solicitud && (
              <p className="text-xs text-slate-600 pt-2 border-t border-red-200">
                Para verificar en qué estado está la inscripción o reemitir el
                QR, contacta a la directiva del Centro de Padres.
              </p>
            )}
          </div>
        )}

        <div className="text-center mt-6">
          <a
            href="/validar"
            className="text-sm text-slate-600 hover:underline"
          >
            ← Validar otro QR
          </a>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
