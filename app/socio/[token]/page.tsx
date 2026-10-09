import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  Estudiante,
  SocioConfig,
  SocioSolicitud,
} from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { AppFooter } from "@/components/app-footer";
import { generarQrDataUrl, urlPublicaSocio } from "@/lib/qr";
import { resolverQrToken } from "@/lib/socios/qr-familia";

export const metadata = { title: "Verificación de socio — CPCC" };
export const dynamic = "force-dynamic";

export default async function SocioPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const [resuelto, { data: cfgData }] = await Promise.all([
    resolverQrToken(admin, token),
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  const config = cfgData as SocioConfig | null;
  const periodoVigente = config?.periodo_anio ?? new Date().getFullYear();

  // CASO C: QR desconocido en apoderados y en socio_solicitudes legacy.
  if (!resuelto) {
    return (
      <PaginaBase>
        <div className="card border-2 border-red-400 bg-red-50 text-center space-y-3">
          <div className="text-6xl">❌</div>
          <div className="text-xl font-bold text-red-900">QR inválido</div>
          <p className="text-sm text-red-800">
            Este QR no corresponde a ningún socio registrado.
          </p>
        </div>
      </PaginaBase>
    );
  }

  const apoderadoId = resuelto.apoderadoId;

  // Buscar solicitud vigente del periodo activo + apoderado + hijos.
  const [{ data: solVigente }, { data: apData }, { data: estData }] =
    await Promise.all([
      admin
        .from("socio_solicitudes")
        .select("*")
        .eq("apoderado_id", apoderadoId)
        .eq("periodo_anio", periodoVigente)
        .in("estado", ["pagada", "enviada"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("apoderados")
        .select("id, nombre")
        .eq("id", apoderadoId)
        .maybeSingle(),
      admin
        .from("estudiantes")
        .select("*")
        .eq("apoderado_id", apoderadoId)
        .eq("activo", true)
        .order("nombre"),
    ]);

  const solicitud = solVigente as SocioSolicitud | null;
  const apoderado = apData as { id: string; nombre: string } | null;
  const hijos = (estData as Estudiante[] | null) ?? [];
  const nombreFamilia = apoderado?.nombre ?? solicitud?.apoderado_nombre ?? "";

  // Ventana temporal del periodo activo.
  const hoy = new Date().toISOString().slice(0, 10);
  const antesDeInicio = !!config?.periodo_inicio && hoy < config.periodo_inicio;
  const despuesDeFin = !!config?.periodo_fin && hoy > config.periodo_fin;

  const activo = !!solicitud && !antesDeInicio && !despuesDeFin;

  // CASO B: QR conocido pero sin solicitud vigente para el periodo actual.
  // (incluye tambien "fuera de ventana temporal").
  if (!activo) {
    const motivoFueraVentana = antesDeInicio
      ? `El período ${periodoVigente} comienza el ${config!.periodo_inicio}.`
      : despuesDeFin
      ? `El período ${periodoVigente} finalizó el ${config!.periodo_fin}.`
      : `Esta familia está registrada, pero aún no ha renovado su membresía para el período ${periodoVigente}.`;

    return (
      <PaginaBase>
        <div className="card border-2 border-amber-400 bg-amber-50 text-center space-y-3">
          <div className="text-6xl">⚠️</div>
          <div className="text-xl font-bold text-amber-900">
            Membresía no vigente
          </div>
          {nombreFamilia && (
            <div className="text-sm text-slate-700">
              Familia: <strong>{nombreFamilia}</strong>
            </div>
          )}
          <p className="text-sm text-amber-900">{motivoFueraVentana}</p>
          <p className="text-xs text-slate-600 pt-2 border-t border-amber-200">
            Para renovar, contacta a la directiva del Centro de Padres.
          </p>
        </div>
      </PaginaBase>
    );
  }

  // CASO A: QR conocido + membresia vigente.
  const qrDataUrl = await generarQrDataUrl(urlPublicaSocio(token), {
    size: 500,
  });

  return (
    <PaginaBase>
      <div className="card border-2 border-green-500 bg-green-50 text-center space-y-3">
        <div className="text-5xl">✅</div>
        <div className="text-xl font-bold text-green-900">
          Socio vigente {periodoVigente}
        </div>

        {qrDataUrl && (
          <div className="pt-3 border-t border-green-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Código QR del socio"
              className="mx-auto w-64 h-64 bg-white p-2 rounded-md border border-green-200"
            />
            <p className="text-xs text-slate-500 mt-2">
              Muestra este código al verificador o descárgalo con click
              derecho &gt; Guardar imagen.
            </p>
          </div>
        )}

        <div className="pt-3 border-t border-green-200 space-y-2 text-sm text-slate-800">
          <div>
            <span className="text-xs uppercase text-slate-500">Familia</span>
            <div className="font-semibold">{nombreFamilia}</div>
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
                {solicitud?.alumno_nombre ?? "—"}
                {solicitud?.curso && (
                  <span className="text-slate-500 font-normal">
                    {" · "}
                    {solicitud.curso}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {solicitud?.pagada_en && (
          <p className="text-xs text-green-800 pt-2 border-t border-green-200">
            Cuota {periodoVigente} pagada el{" "}
            {new Date(solicitud.pagada_en).toLocaleDateString("es-CL")}
          </p>
        )}
      </div>
    </PaginaBase>
  );
}

function PaginaBase({ children }: { children: React.ReactNode }) {
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
        {children}
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
