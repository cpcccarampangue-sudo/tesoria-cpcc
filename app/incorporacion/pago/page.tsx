import { notFound } from "next/navigation";
import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SocioSolicitud } from "@/lib/types";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import {
  crearCheckout,
  obtenerCheckout,
  SumUpError,
  describeSumUpError,
} from "@/lib/sumup/client";
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

// Resultado del helper de resolucion de checkout. Permite que la UI
// decida sin ambiguedad entre: mostrar boton pagar, mostrar banner de
// pagada (incluso si DB todavia no lo refleja porque el webhook esta en
// vuelo), mostrar error de datos (mismatch grave) o error generico.
type ResolucionCheckout =
  | { tipo: "pendiente"; url: string }
  | { tipo: "pagada_live" }
  | { tipo: "mismatch"; detalle: string }
  | { tipo: "error" };

// Reference base. Cuando necesitamos recrear un checkout (porque el
// anterior quedo FAILED/EXPIRED/CANCELED o el GET live devolvio 404),
// agregamos un sufijo "_r<timestamp>" para no reutilizar la misma
// reference y evitar 409 DUPLICATED_CHECKOUT. El webhook extrae el UUID
// con regex, tolerando ambos formatos (ver /api/webhooks/sumup).
function nuevaReference(solicitudId: string, esRetry: boolean): string {
  return esRetry
    ? `socio_${solicitudId}_r${Date.now()}`
    : `socio_${solicitudId}`;
}

// Resuelve la URL del hosted checkout SumUp para una solicitud en
// pendiente_pago. Es IDEMPOTENTE:
//   - Si ya hay sumup_checkout_id, hace GET live y decide segun el status.
//   - Nunca reutiliza una misma reference para crear un segundo checkout
//     (eso dispara 409 DUPLICATED_CHECKOUT en SumUp).
async function resolverUrlCheckout(
  solicitud: SocioSolicitud
): Promise<ResolucionCheckout> {
  const admin = createSupabaseAdminClient();
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE;

  // Caso 1: ya hay checkout guardado → GET live y decidir.
  if (solicitud.sumup_checkout_id) {
    let live;
    try {
      live = await obtenerCheckout(solicitud.sumup_checkout_id);
    } catch (err) {
      // 404 u otro error de GET live: el checkout no es consultable.
      // No reutilizamos la reference anterior; creamos uno con sufijo.
      console.error(
        "[incorporacion/pago] obtenerCheckout fallo, se crea con reference versionada:",
        err instanceof Error ? err.message : String(err)
      );
      return await crearYGuardar(solicitud, true);
    }

    // Validar integridad del checkout live contra la solicitud.
    const refOk = (live.checkout_reference ?? "").startsWith(
      `socio_${solicitud.id}`
    );
    const amountOk = Number(live.amount) === Number(solicitud.monto_cuota);
    const currencyOk = live.currency === "CLP";
    const merchantOk =
      !expectedMerchant ||
      !live.merchant_code ||
      live.merchant_code === expectedMerchant;
    if (!refOk || !amountOk || !currencyOk || !merchantOk) {
      const detalle = `refOk=${refOk} amountOk=${amountOk} currencyOk=${currencyOk} merchantOk=${merchantOk} liveRef=${live.checkout_reference} liveAmount=${live.amount} liveCurrency=${live.currency} liveStatus=${live.status}`;
      console.error(
        "[incorporacion/pago] checkout live no coincide con solicitud:",
        detalle
      );
      return { tipo: "mismatch", detalle };
    }

    if (live.status === "PENDING") {
      const url = live.hosted_checkout_url ?? live.checkout_url ?? null;
      return url ? { tipo: "pendiente", url } : { tipo: "error" };
    }
    if (live.status === "PAID") {
      // No creamos otro. El webhook ya deberia haber actualizado DB; si
      // esta en vuelo, el proximo refresh lo mostrara. UI pone banner.
      return { tipo: "pagada_live" };
    }
    // FAILED / EXPIRED / CANCELED → crear uno nuevo con reference nueva.
    return await crearYGuardar(solicitud, true);
  }

  // Caso 2: no hay checkout guardado → crear con reference base.
  return await crearYGuardar(solicitud, false);

  // Helper interno (closure sobre admin + expectedMerchant).
  async function crearYGuardar(
    s: SocioSolicitud,
    esRetry: boolean
  ): Promise<ResolucionCheckout> {
    const checkoutReference = nuevaReference(s.id, esRetry);
    try {
      const checkout = await crearCheckout({
        checkoutReference,
        amount: s.monto_cuota,
        currency: "CLP",
        description: `Cuota socio CdP ${s.periodo_anio} - ${s.apoderado_nombre}`,
        redirectUrl: `${siteUrl()}/incorporacion/pago?token=${s.qr_token}`,
        payToEmail: s.apoderado_email,
        payerName: s.apoderado_nombre,
      });
      // Guardamos inmediatamente antes de devolver la URL, para que un
      // reload posterior encuentre el id y no vuelva a crear.
      await admin
        .from("socio_solicitudes")
        .update({ sumup_checkout_id: checkout.id })
        .eq("id", s.id);
      const url =
        checkout.hosted_checkout_url ?? checkout.checkout_url ?? null;
      return url ? { tipo: "pendiente", url } : { tipo: "error" };
    } catch (err) {
      // Red de seguridad: si vino 409 DUPLICATED_CHECKOUT y tenemos
      // sumup_checkout_id guardado, intentamos recuperar el checkout
      // existente antes de rendirnos. Esto cubre el bug que llevo a
      // esta solicitud al estado actual.
      if (
        err instanceof SumUpError &&
        err.status === 409 &&
        s.sumup_checkout_id
      ) {
        try {
          const live = await obtenerCheckout(s.sumup_checkout_id);
          if (live.status === "PENDING") {
            const url =
              live.hosted_checkout_url ?? live.checkout_url ?? null;
            if (url) {
              console.warn(
                "[incorporacion/pago] 409 duplicated: recuperado checkout PENDING existente"
              );
              return { tipo: "pendiente", url };
            }
          }
          if (live.status === "PAID") {
            console.warn(
              "[incorporacion/pago] 409 duplicated: checkout existente ya esta PAID"
            );
            return { tipo: "pagada_live" };
          }
        } catch {
          // fallback al return error de abajo
        }
      }
      console.error(
        "[incorporacion/pago] crearCheckout fallo:",
        describeSumUpError(err)
      );
      return { tipo: "error" };
    }
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

  const yaPagadaDB =
    solicitud.estado === "pagada" || solicitud.estado === "enviada";

  // Si esta pendiente, generar/recuperar URL del checkout dinamico.
  // Esta pagina NO marca pagada por si misma en DB: solo refleja el
  // estado actual (DB o live) y expone el hosted checkout SumUp.
  const resolucion = yaPagadaDB ? null : await resolverUrlCheckout(solicitud);
  const yaPagada = yaPagadaDB || resolucion?.tipo === "pagada_live";
  const checkoutUrl =
    resolucion?.tipo === "pendiente" ? resolucion.url : null;

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
