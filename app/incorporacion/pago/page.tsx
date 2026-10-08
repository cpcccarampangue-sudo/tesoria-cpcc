import { notFound } from "next/navigation";
import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import {
  resolverCheckoutIdempotente,
  type ResolucionCheckout,
} from "@/lib/sumup/pago-resolver";
import { AppFooter } from "@/components/app-footer";

export const metadata = {
  title: "Pago de cuota — Incorporación",
};
export const dynamic = "force-dynamic";

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function PagoPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = firstParam(sp.token);
  if (!token) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: solData } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("qr_token", token)
    .maybeSingle();
  const solicitud = solData as SocioSolicitud | null;

  if (!solicitud) notFound();

  const yaPagadaDB =
    solicitud.estado === "pagada" || solicitud.estado === "enviada";

  // Resolver idempotente (ver lib/sumup/pago-resolver.ts). Esta pagina
  // NO marca pagada por si misma en DB: solo refleja el estado actual
  // (DB o live) y expone el hosted checkout SumUp. La reconciliacion
  // cuando live=PAID y DB=pendiente_pago se maneja aparte (futura
  // rutina idempotente que use ResolucionCheckout.live).
  const admin = createSupabaseAdminClient();
  const resolucion: ResolucionCheckout | null = yaPagadaDB
    ? null
    : await resolverCheckoutIdempotente(admin, solicitud);

  const yaPagada = yaPagadaDB || resolucion?.tipo === "pagada_live";

  const pendienteUrl =
    resolucion?.tipo === "pendiente_nuevo" ||
    resolucion?.tipo === "pendiente_reutilizado" ||
    resolucion?.tipo === "pendiente_versionado" ||
    resolucion?.tipo === "pendiente_recuperado_409"
      ? resolucion.url
      : null;

  const esReutilizado =
    resolucion?.tipo === "pendiente_reutilizado" ||
    resolucion?.tipo === "pendiente_recuperado_409";

  const esVerificacionTemporal =
    resolucion?.tipo === "verificacion_temporal_no_disponible";

  const esErrorPermanente =
    resolucion?.tipo === "mismatch" || resolucion?.tipo === "error_fatal";

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-1 w-full max-w-xl mx-auto px-4 py-8">
        <header className="text-center mb-6">
          <Image
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            width={120}
            height={120}
            className="mx-auto h-20 w-20 object-contain mb-2"
            priority
          />
          <h1 className="text-xl font-semibold text-slate-900">
            {yaPagada
              ? yaPagadaDB
                ? "¡Pago recibido!"
                : "Pago recibido"
              : "Último paso: realizar el pago"}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {INSTITUCION_NOMBRE} — Colegio Carampangue
          </p>
        </header>

        <div className="card space-y-3">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-slate-500">Apoderado</dt>
              <dd className="font-medium">{solicitud.apoderado_nombre}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Correo</dt>
              <dd>{solicitud.apoderado_email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Alumno</dt>
              <dd>{solicitud.alumno_nombre}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Curso</dt>
              <dd>{solicitud.curso}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Período</dt>
              <dd>Socio {solicitud.periodo_anio}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Monto</dt>
              <dd className="font-bold text-lg">
                ${solicitud.monto_cuota.toLocaleString("es-CL")} CLP
              </dd>
            </div>
          </dl>
        </div>

        {yaPagadaDB ? (
          <div className="card bg-green-50 border border-green-200 mt-4 text-sm text-green-900">
            <strong>El pago ya fue confirmado.</strong> Revisa tu correo —
            deberías tener el QR en tu bandeja de entrada. Si no lo
            encuentras, contacta a la directiva para solicitar un reenvío.
          </div>
        ) : resolucion?.tipo === "pagada_live" ? (
          <div className="card bg-green-50 border border-green-200 mt-4 text-sm text-green-900">
            <strong>Pago recibido.</strong> Estamos confirmando tu
            incorporación. En los próximos minutos recibirás el QR por correo
            a <strong>{solicitud.apoderado_email}</strong>. Si no llega en 15
            minutos, contacta a la tesorería.
          </div>
        ) : pendienteUrl ? (
          <>
            {esReutilizado && (
              <div className="card bg-blue-50 border border-blue-200 mt-4 text-sm text-blue-900">
                Ya existe un pago iniciado para esta solicitud. Puedes
                continuar con el mismo enlace.
              </div>
            )}
            <a
              href={pendienteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full text-center mt-4 py-4 text-lg"
            >
              💳 Pagar con SumUp →
            </a>
            <div className="card bg-blue-50 border border-blue-200 mt-4 text-sm text-blue-900 space-y-2">
              <div className="font-semibold">Después del pago</div>
              <ol className="list-decimal pl-5 space-y-1 text-xs">
                <li>
                  Completa el pago en la pestaña nueva que se abrió con SumUp.
                </li>
                <li>
                  Una vez confirmado el pago, en los próximos minutos recibirás
                  en tu correo (<strong>{solicitud.apoderado_email}</strong>) un
                  mensaje con tu código QR de socio activo{" "}
                  {solicitud.periodo_anio}.
                </li>
                <li>
                  Si no recibes el correo en 15 minutos, revisa tu carpeta de
                  <strong> Spam</strong> o contacta a la directiva.
                </li>
              </ol>
            </div>
          </>
        ) : esVerificacionTemporal ? (
          <div className="card bg-amber-50 border border-amber-200 mt-4 text-sm text-amber-900 space-y-2">
            <strong>
              No pudimos verificar el estado del pago en este momento.
            </strong>
            <p>Intenta nuevamente en unos segundos.</p>
            <form action="" method="get">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn-secondary w-full mt-2">
                Verificar nuevamente
              </button>
            </form>
          </div>
        ) : esErrorPermanente ? (
          <div className="card bg-red-50 border border-red-200 mt-4 text-sm text-red-900 space-y-2">
            <strong>Hubo un problema con tu pago.</strong>
            <p>Contacta a la tesorería del Centro de Padres.</p>
          </div>
        ) : (
          // Fallback defensivo (no deberia ocurrir con el resolver).
          <div className="card bg-amber-50 border border-amber-200 mt-4 text-sm text-amber-900 space-y-2">
            <strong>
              No pudimos verificar el estado del pago en este momento.
            </strong>
            <p>Intenta nuevamente en unos segundos.</p>
            <form action="" method="get">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn-secondary w-full mt-2">
                Verificar nuevamente
              </button>
            </form>
          </div>
        )}

        <div className="text-center mt-6">
          <a
            href="/incorporacion"
            className="text-sm text-slate-600 hover:underline"
          >
            ← Volver al inicio
          </a>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
