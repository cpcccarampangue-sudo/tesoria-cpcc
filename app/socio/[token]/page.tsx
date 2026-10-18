import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";
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

  // Minimización de datos: la página pública /socio/{token} es anónima
  // (su único control es que el token UUID v4 es impredecible). Para
  // reducir superficie si un link se filtra, mostramos lo mínimo:
  // estado, período, nombre reducido y la vigencia. NO exponemos lista
  // de hijos, cursos, fecha de pago exacta ni nombre completo.
  const [{ data: solVigente }, { data: apData }] = await Promise.all([
    admin
      .from("socio_solicitudes")
      .select("estado, periodo_anio")
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
  ]);

  const solicitud = solVigente as Pick<
    SocioSolicitud,
    "estado" | "periodo_anio"
  > | null;
  const apoderado = apData as { id: string; nombre: string } | null;
  const nombreApoderadoCompleto = apoderado?.nombre ?? "";
  const nombreReducido = reducirNombre(nombreApoderadoCompleto);

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
      : `Esta credencial está registrada, pero aún no se ha renovado la membresía para el período ${periodoVigente}.`;

    return (
      <PaginaBase>
        <div className="card border-2 border-amber-400 bg-amber-50 text-center space-y-3">
          <div className="text-6xl">⚠️</div>
          <div className="text-xl font-bold text-amber-900">
            Membresía no vigente
          </div>
          {nombreReducido !== "—" && (
            <div className="text-sm text-slate-700">
              Credencial: <strong>{nombreReducido}</strong>
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
  const vigenciaHasta = formatearVigencia(
    config?.periodo_fin ?? null,
    periodoVigente
  );

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

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 border-t border-green-200 text-sm text-slate-800">
          <div>
            <dt className="text-xs uppercase text-slate-500">Credencial</dt>
            <dd className="font-semibold">{nombreReducido}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Categoría</dt>
            <dd className="font-semibold">Apoderado</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Vigencia</dt>
            <dd className="font-semibold">{vigenciaHasta}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Período</dt>
            <dd className="font-semibold">{periodoVigente}</dd>
          </div>
        </dl>
      </div>
    </PaginaBase>
  );
}

// Nombre reducido: "María Angélica Pérez" -> "María P.". Mismo criterio
// que /api/socios/validar — minimiza info personal en vistas públicas.
function reducirNombre(nombre: string): string {
  const partes = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (partes.length === 0) return "—";
  if (partes.length === 1) return partes[0];
  const primero = partes[0];
  const siguiente = partes[1];
  const inicial = siguiente[0]?.toUpperCase() ?? "";
  return inicial ? `${primero} ${inicial}.` : primero;
}

function formatearVigencia(
  periodoFin: string | null,
  periodo: number
): string {
  const iso = periodoFin ?? `${periodo}-12-31`;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
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
