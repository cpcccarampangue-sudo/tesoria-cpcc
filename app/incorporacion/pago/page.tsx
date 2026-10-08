import { notFound } from "next/navigation";
import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { crearCheckout, obtenerCheckout } from "@/lib/sumup/client";
import { siteUrl } from "@/lib/qr";
import { AppFooter } from "@/components/app-footer";

export const metadata = {
  title: "Pago de cuota — Incorporación",
};
export const dynamic = "force-dynamic";

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

// Resuelve la URL del hosted checkout SumUp para una solicitud en
// pendiente_pago. Reutiliza el checkout existente si sigue PENDING;
// crea uno nuevo si no hay o el anterior ya no sirve. Devuelve null si
// hubo cualquier error (la UI muestra aviso de contactar a la directiva).
async function resolverUrlCheckout(
  solicitud: SocioSolicitud
): Promise<string | null> {
  try {
    // 1) Si ya hay checkout previo, verificar si sigue vivo.
    if (solicitud.sumup_checkout_id) {
      try {
        const live = await obtenerCheckout(solicitud.sumup_checkout_id);
        if (live.status === "PENDING") {
          return live.hosted_checkout_url ?? live.checkout_url ?? null;
        }
        // EXPIRED / FAILED / CANCELED: creamos uno nuevo abajo.
      } catch (err) {
        console.error(
          "[incorporacion/pago] obtenerCheckout fallo:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    // 2) Crear nuevo checkout. amount proviene del snapshot
    //    solicitud.monto_cuota (ya resuelto por precioVigente al crear
    //    la solicitud). SumUp hosted_checkout:enabled devuelve una URL
    //    lista para redirigir.
    const checkout = await crearCheckout({
      checkoutReference: `socio_${solicitud.id}`,
      amount: solicitud.monto_cuota,
      currency: "CLP",
      description: `Cuota socio CdP ${solicitud.periodo_anio} - ${solicitud.apoderado_nombre}`,
      // redirectUrl = retorno visual del browser tras hosted checkout
      // (vuelve a esta misma pantalla, que mostrara el estado actual
      // post-webhook). El return_url (webhook) lo pone el helper al
      // dominio canonico de /api/webhooks/sumup.
      redirectUrl: `${siteUrl()}/incorporacion/pago?token=${solicitud.qr_token}`,
      payToEmail: solicitud.apoderado_email,
      payerName: solicitud.apoderado_nombre,
    });
    const admin = createSupabaseAdminClient();
    await admin
      .from("socio_solicitudes")
      .update({ sumup_checkout_id: checkout.id })
      .eq("id", solicitud.id);
    return checkout.hosted_checkout_url ?? checkout.checkout_url ?? null;
  } catch (err) {
    console.error(
      "[incorporacion/pago] resolverUrlCheckout fallo:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
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

  const yaPagada =
    solicitud.estado === "pagada" || solicitud.estado === "enviada";

  // Si esta pendiente, generar/recuperar URL del checkout dinamico.
  // Esta pagina NO marca pagada por si misma: solo refleja el estado
  // actual de la solicitud en DB y expone el hosted checkout SumUp.
  const checkoutUrl = yaPagada ? null : await resolverUrlCheckout(solicitud);

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
        ) : checkoutUrl ? (
          <>
            <a
              href={checkoutUrl}
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
          <div className="card bg-amber-50 border border-amber-200 mt-4 text-sm text-amber-900 space-y-2">
            <strong>
              No pudimos generar el enlace de pago en este momento.
            </strong>
            <p>
              Por favor recarga esta página en unos minutos para reintentar. Si
              el problema persiste, contacta a la tesorería del Centro de
              Padres.
            </p>
            <form action="" method="get">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="btn-secondary w-full mt-2"
              >
                Reintentar
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
