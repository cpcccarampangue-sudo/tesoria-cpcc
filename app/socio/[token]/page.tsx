import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Estudiante,
  SocioConfig,
  SocioSolicitud,
} from "@/lib/types";
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

  // Cargamos los hijos de la familia linkeada para mostrarlos en el QR.
  // Si no esta linkeada (solicitudes antiguas), caemos al alumno_nombre
  // string.
  let hijos: Estudiante[] = [];
  if (solicitud?.apoderado_id) {
    const { data: estData } = await supabase
      .from("estudiantes")
      .select("*")
      .eq("apoderado_id", solicitud.apoderado_id)
      .eq("activo", true)
      .order("nombre");
    hijos = (estData as Estudiante[] | null) ?? [];
  }

  // Reglas de validez:
  //  - La solicitud existe
  //  - Estado es "enviada" (QR ya emitido)
  //  - El periodo coincide con el periodo vigente de la config
  //  - La fecha de hoy esta entre periodo_inicio y periodo_fin (si configurados)
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();
  const hoy = new Date().toISOString().slice(0, 10);
  const antesDeInicio =
    !!config?.periodo_inicio && hoy < config.periodo_inicio;
  const despuesDeFin = !!config?.periodo_fin && hoy > config.periodo_fin;
  const activo =
    !!solicitud &&
    solicitud.estado === "enviada" &&
    solicitud.periodo_anio === periodoVigente &&
    !antesDeInicio &&
    !despuesDeFin;

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
    : antesDeInicio
    ? `El período ${periodoVigente} empieza el ${config!.periodo_inicio}. Vuelve a escanear a partir de esa fecha.`
    : despuesDeFin
    ? `Este QR expiró el ${config!.periodo_fin}. El período ${periodoVigente} ya finalizó.`
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
            <div className="pt-3 border-t border-green-200 space-y-2 text-sm text-slate-800">
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
                  {hijos.length > 1 ? "Alumnos" : "Alumno"}
                </span>
                {hijos.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {hijos.map((h) => (
                      <li key={h.id} className="font-medium">
                        {h.nombre}
                        {h.curso && (
                          <span className="text-slate-500 font-normal">
                            {" · "}
                            {h.curso}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="font-medium">
                    {solicitud.alumno_nombre}
                    {solicitud.curso && (
                      <span className="text-slate-500 font-normal">
                        {" · "}
                        {solicitud.curso}
                      </span>
                    )}
                  </div>
                )}
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
