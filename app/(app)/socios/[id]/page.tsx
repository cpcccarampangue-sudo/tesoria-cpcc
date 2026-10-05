import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SOCIO_ESTADO_LABEL,
  type SocioEstado,
  type SocioSolicitud,
} from "@/lib/types";
import { AccionesSolicitud } from "./acciones";

export const metadata = { title: "Solicitud de socio — Tesorería CPCC" };
export const dynamic = "force-dynamic";

const ESTADO_BADGE: Record<SocioEstado, string> = {
  pendiente_pago: "badge-amber",
  pagada: "badge-blue",
  enviada: "badge-green",
  rechazada: "badge-red",
  anulada: "badge-slate",
};

export default async function SolicitudDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const s = data as SocioSolicitud;

  // URL publica del QR (lo que codifica el QR en si).
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://tesoria-cpcc.vercel.app";
  const urlPublica = `${siteUrl}/socio/${s.qr_token}`;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link
          href="/socios"
          className="text-sm text-slate-600 hover:underline"
        >
          ← Volver a socios
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {s.apoderado_nombre}
          </h1>
          <p className="text-sm text-slate-600">
            Solicitud de socio {s.periodo_anio} ·{" "}
            <span className={`${ESTADO_BADGE[s.estado]} text-xs ml-1`}>
              {SOCIO_ESTADO_LABEL[s.estado]}
            </span>
          </p>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Datos</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-slate-500">
              Apoderado
            </dt>
            <dd className="font-medium">
              {s.apoderado_id ? (
                <Link
                  href={`/apoderados/${s.apoderado_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {s.apoderado_nombre} ↗
                </Link>
              ) : (
                <>
                  {s.apoderado_nombre}
                  <span className="ml-2 text-xs text-amber-700">
                    (sin link a familia)
                  </span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Correo</dt>
            <dd>{s.apoderado_email}</dd>
          </div>
          {s.apoderado_rut && (
            <div>
              <dt className="text-xs uppercase text-slate-500">RUT</dt>
              <dd className="font-mono">{s.apoderado_rut}</dd>
            </div>
          )}
          {s.apoderado_telefono && (
            <div>
              <dt className="text-xs uppercase text-slate-500">Teléfono</dt>
              <dd>{s.apoderado_telefono}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase text-slate-500">Alumno</dt>
            <dd>{s.alumno_nombre}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Curso</dt>
            <dd>{s.curso}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Monto cuota</dt>
            <dd className="font-semibold">
              ${s.monto_cuota.toLocaleString("es-CL")}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Creada</dt>
            <dd>{new Date(s.created_at).toLocaleString("es-CL")}</dd>
          </div>
          {s.pagada_en && (
            <div>
              <dt className="text-xs uppercase text-slate-500">
                Fecha de pago
              </dt>
              <dd>{new Date(s.pagada_en).toLocaleString("es-CL")}</dd>
            </div>
          )}
          {s.email_enviado_en && (
            <div>
              <dt className="text-xs uppercase text-slate-500">
                QR enviado
              </dt>
              <dd>
                {new Date(s.email_enviado_en).toLocaleString("es-CL")}
                {s.email_reenvios > 0 && (
                  <span className="text-xs text-slate-500 ml-2">
                    ({s.email_reenvios} reenvío
                    {s.email_reenvios > 1 ? "s" : ""})
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* SumUp (si tiene datos de pago registrados) */}
      {(s.sumup_checkout_id || s.sumup_transaction_id) && (
        <div className="card">
          <h2 className="font-semibold mb-3">Pago vía SumUp</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {s.sumup_checkout_id && (
              <div>
                <dt className="text-xs uppercase text-slate-500">
                  Checkout ID
                </dt>
                <dd className="font-mono text-xs">{s.sumup_checkout_id}</dd>
              </div>
            )}
            {s.sumup_transaction_id && (
              <div>
                <dt className="text-xs uppercase text-slate-500">
                  Transaction ID
                </dt>
                <dd className="font-mono text-xs">
                  {s.sumup_transaction_id}
                </dd>
              </div>
            )}
            {s.sumup_transaction_code && (
              <div>
                <dt className="text-xs uppercase text-slate-500">
                  Código SumUp
                </dt>
                <dd className="font-mono text-xs">
                  {s.sumup_transaction_code}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* URL publica del QR */}
      <div className="card">
        <h2 className="font-semibold mb-2">URL pública del QR</h2>
        <p className="text-xs text-slate-500 mb-2">
          Esto es lo que codifica el QR. Al escanearlo con la cámara se abre
          la página de verificación pública.
        </p>
        <div className="bg-slate-50 border border-slate-200 rounded-md p-2 font-mono text-xs break-all">
          {urlPublica}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/socio/${s.qr_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs"
          >
            Ver página pública ↗
          </Link>
        </div>
      </div>

      {/* Notas internas */}
      {s.notas_internas && (
        <div className="card bg-slate-50 text-sm">
          <h2 className="font-semibold mb-2">Notas internas</h2>
          <p className="whitespace-pre-wrap">{s.notas_internas}</p>
        </div>
      )}

      {/* Acciones */}
      <div className="card">
        <h2 className="font-semibold mb-3">Acciones</h2>
        <AccionesSolicitud solicitud={s} />
      </div>
    </div>
  );
}
