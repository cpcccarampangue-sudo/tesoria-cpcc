import { notFound } from "next/navigation";
import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig, SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { linkParaMonto } from "@/lib/socios/precio";
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

  if (!solicitud) notFound();

  const yaPagada = solicitud.estado === "pagada" || solicitud.estado === "enviada";
  // Elige el Payment Link SumUp cuyo monto preconfigurado coincide
  // EXACTAMENTE con el monto de la solicitud (snapshot). Si no hay link
  // para ese monto, mostramos aviso en vez de un boton que cobre otro
  // valor. Esto previene cobrar $20.000 cuando la promo decia $18.500.
  const linkPago = config
    ? linkParaMonto(config, solicitud.monto_cuota)
    : null;

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
            {yaPagada ? "¡Pago recibido!" : "Último paso: realizar el pago"}
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

        {yaPagada ? (
          <div className="card bg-green-50 border border-green-200 mt-4 text-sm text-green-900">
            <strong>El pago ya fue confirmado.</strong> Revisa tu correo —
            deberías tener el QR en tu bandeja de entrada. Si no lo
            encuentras, contacta a la directiva para solicitar un reenvío.
          </div>
        ) : linkPago ? (
          <>
            <a
              href={linkPago}
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
        ) : (
          <div className="card bg-amber-50 border border-amber-200 mt-4 text-sm text-amber-900">
            <strong>
              Link de pago para ${solicitud.monto_cuota.toLocaleString("es-CL")}{" "}
              CLP no está configurado.
            </strong>{" "}
            Para evitar cobrar un monto incorrecto no mostramos un link
            genérico. Por favor contacta directamente a la tesorería para
            completar tu incorporación como socio.
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
